using System.Data;
using System.Data.Common;
using Dapper;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Search;

namespace Quizymode.Api.Features.Search;

/// <summary>
/// GET /search (#320): one grouped search over topics (in-memory taxonomy), discoverable public collections,
/// public items, and the signed-in caller's own content. The query text is never logged or stored.
/// </summary>
public static class GlobalSearch
{
    public const int MinQueryLength = 2;
    public const int MaxQueryLength = 100;
    public const int DefaultLimit = 5;
    public const int MaxLimit = 20;
    public const int MaxOffset = 200;

    public const string TypeCategories = "categories";
    public const string TypeSubcategories = "subcategories";
    public const string TypeCollections = "collections";
    public const string TypeItems = "items";
    public const string TypeMine = "mine";

    public static readonly IReadOnlyList<string> AllTypes =
        [TypeCategories, TypeSubcategories, TypeCollections, TypeItems, TypeMine];

    public const string KindCollection = "collection";
    public const string KindStudyGuideDocument = "studyGuideDocument";
    public const string KindItem = "item";

    private const char HighlightStart = '';
    private const char HighlightEnd = '';

    public sealed record Request(string? Q, string? Types, int? Limit, int? Offset);

    public sealed record Group<T>(IReadOnlyList<T> Results, bool HasMore);

    public sealed record CategoryResult(string Slug, string Name, string? Description, int ItemCount);

    public sealed record SubcategoryResult(string CategorySlug, string L1, string? L2, string? Description, int ItemCount);

    public sealed record CollectionResult(Guid Id, string Name, string? Description, int ItemCount);

    public sealed record Highlight(int Start, int Length);

    public sealed record Snippet(string Text, IReadOnlyList<Highlight> Highlights);

    public sealed record ItemResult(Guid Id, Snippet Snippet, string? CategorySlug, string? L1, string? L2);

    public sealed record MineResult(string Kind, Guid Id, string Title);

    /// <summary>A group is null when it was not requested or is not permitted (for example <c>mine</c> for anonymous callers).</summary>
    public sealed record Groups(
        Group<CategoryResult>? Categories,
        Group<SubcategoryResult>? Subcategories,
        Group<CollectionResult>? Collections,
        Group<ItemResult>? Items,
        Group<MineResult>? Mine);

    public sealed record Response(string Query, Groups Groups);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(request => request.Q)
                .Must(q => !string.IsNullOrWhiteSpace(q) && q.Trim().Length >= MinQueryLength && q.Trim().Length <= MaxQueryLength)
                .WithMessage($"q must be {MinQueryLength} to {MaxQueryLength} characters.");

            RuleFor(request => request.Types)
                .Must(types => TryParseTypes(types, out _))
                .WithMessage($"types must be a comma-separated list of: {string.Join(", ", AllTypes)}.");

            RuleFor(request => request.Limit)
                .InclusiveBetween(1, MaxLimit)
                .When(request => request.Limit.HasValue)
                .WithMessage($"limit must be between 1 and {MaxLimit}.");

            RuleFor(request => request.Offset)
                .InclusiveBetween(0, MaxOffset)
                .When(request => request.Offset.HasValue)
                .WithMessage($"offset must be between 0 and {MaxOffset}.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("search", Handler)
                .WithTags("Search")
                .WithSummary("Global search across topics, collections, questions and the caller's own content")
                .WithDescription(
                    "Returns up to `limit` results per requested group (categories, subcategories, collections, items, mine). " +
                    "Only discoverable public collections and non-private items are searched; `mine` is null for anonymous callers. " +
                    "Topic counts are public-only.")
                .AllowAnonymous()
                .RequireRateLimiting("search")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
                .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests);
        }

        private static async Task<IResult> Handler(
            string? q,
            string? types,
            int? limit,
            int? offset,
            ApplicationDbContext db,
            IUserContext userContext,
            ITaxonomySearchIndex index,
            [FromServices] TaxonomySearchCounts counts,
            ILogger<Endpoint> logger,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(
                new Request(q, types, limit, offset),
                db,
                userContext,
                index,
                counts,
                logger,
                cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    internal static async Task<Result<Response>> HandleAsync(
        Request request,
        ApplicationDbContext db,
        IUserContext userContext,
        ITaxonomySearchIndex index,
        TaxonomySearchCounts counts,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        ValidationResult validation = new Validator().Validate(request);
        if (!validation.IsValid)
        {
            return Result.Failure<Response>(Error.Validation("Search.Invalid", validation.Errors[0].ErrorMessage));
        }

        string q = request.Q!.Trim();
        TryParseTypes(request.Types, out HashSet<string> types);
        int limit = request.Limit ?? DefaultLimit;
        int offset = request.Offset ?? 0;
        // Past the last reachable offset there is no next page, so the client's Next button disables.
        bool canPage = offset + limit <= MaxOffset;

        string? userId = userContext.IsAuthenticated && Guid.TryParse(userContext.UserId, out Guid parsedUserId)
            ? parsedUserId.ToString()
            : null;

        // Trailing whitespace tells the parser the last word is finished (no prefix match), so keep one space.
        bool wordFinished = char.IsWhiteSpace(request.Q![^1]);
        ParsedSearchQuery parsed = SearchQueryParser.Parse(wordFinished ? q + " " : q);
        if (!parsed.IsSearchable)
        {
            return Result.Success(new Response(q, EmptyGroups(types, userId is not null)));
        }

        Group<CategoryResult>? categories = null;
        Group<SubcategoryResult>? subcategories = null;
        if (types.Contains(TypeCategories) || types.Contains(TypeSubcategories))
        {
            await counts.EnsureFreshAsync(db, cancellationToken);
        }

        if (types.Contains(TypeCategories))
        {
            List<TaxonomySearchHit> hits = index.Search(q, TaxonomyNodeLevels.Category, limit + 1, offset).ToList();
            categories = new Group<CategoryResult>(
                hits.Take(limit)
                    .Select(hit => new CategoryResult(hit.Node.CategorySlug, hit.Node.CategoryName, hit.Node.Description, hit.Node.PublicItemCount))
                    .ToList(),
                hits.Count > limit && canPage);
        }

        if (types.Contains(TypeSubcategories))
        {
            List<TaxonomySearchHit> hits = index.Search(q, TaxonomyNodeLevels.Subcategories, limit + 1, offset).ToList();
            subcategories = new Group<SubcategoryResult>(
                hits.Take(limit)
                    .Select(hit => new SubcategoryResult(
                        hit.Node.CategorySlug,
                        hit.Node.L1Slug!,
                        hit.Node.L2Slug,
                        hit.Node.Description,
                        hit.Node.PublicItemCount))
                    .ToList(),
                hits.Count > limit && canPage);
        }

        bool wantCollections = types.Contains(TypeCollections);
        bool wantItems = types.Contains(TypeItems);
        bool wantMine = types.Contains(TypeMine) && userId is not null;

        Group<CollectionResult>? collections = null;
        Group<ItemResult>? items = null;
        Group<MineResult>? mine = null;

        if (wantCollections || wantItems || wantMine)
        {
            try
            {
                DbConnection connection = db.Database.GetDbConnection();
                if (connection.State != ConnectionState.Open)
                {
                    await db.Database.OpenConnectionAsync(cancellationToken);
                }

                (collections, items, mine) = await QueryDatabaseAsync(
                    connection, parsed, q, userId, wantCollections, wantItems, wantMine, limit, offset, canPage, cancellationToken);
            }
            catch (PostgresException exception)
            {
                // Never include q in the log: it is user text.
                logger.LogWarning(
                    "Global search query failed with SQLSTATE {SqlState}; returning empty results.",
                    exception.SqlState);
                collections = wantCollections ? new Group<CollectionResult>([], false) : null;
                items = wantItems ? new Group<ItemResult>([], false) : null;
                mine = wantMine ? new Group<MineResult>([], false) : null;
            }
        }

        return Result.Success(new Response(q, new Groups(categories, subcategories, collections, items, mine)));
    }

    private static async Task<(Group<CollectionResult>?, Group<ItemResult>?, Group<MineResult>?)> QueryDatabaseAsync(
        DbConnection connection,
        ParsedSearchQuery parsed,
        string q,
        string? userId,
        bool wantCollections,
        bool wantItems,
        bool wantMine,
        int limit,
        int offset,
        bool canPage,
        CancellationToken cancellationToken)
    {
        string tsq = SearchQueryParser.BuildTsQuerySql(parsed, "@Head", "@Prefix");

        DynamicParameters parameters = new();
        parameters.Add("Head", parsed.Head, DbType.String);
        parameters.Add("Prefix", parsed.PrefixToken is null ? null : SearchQueryParser.ToPrefixTsQueryValue(parsed.PrefixToken), DbType.String);
        parameters.Add("Q", q, DbType.String);
        parameters.Add("UserId", userId, DbType.String);
        parameters.Add("Like", $"%{EscapeLike(q)}%", DbType.String);
        parameters.Add("Limit1", limit + 1, DbType.Int32);
        parameters.Add("Offset", offset, DbType.Int32);

        List<string> batches = [];
        if (wantCollections)
        {
            batches.Add(BuildCollectionsSql(tsq));
        }

        if (wantItems)
        {
            batches.Add(BuildItemsSql(tsq));
        }

        if (wantMine)
        {
            batches.Add(BuildMineSql(tsq));
        }

        Group<CollectionResult>? collections = null;
        Group<ItemResult>? items = null;
        Group<MineResult>? mine = null;

        await using SqlMapper.GridReader grid = await connection.QueryMultipleAsync(
            new CommandDefinition(string.Join("\n", batches), parameters, cancellationToken: cancellationToken));

        if (wantCollections)
        {
            List<CollectionRow> rows = (await grid.ReadAsync<CollectionRow>()).ToList();
            collections = new Group<CollectionResult>(
                rows.Take(limit).Select(row => new CollectionResult(row.Id, row.Name, row.Description, row.ItemCount)).ToList(),
                rows.Count > limit && canPage);
        }

        if (wantItems)
        {
            List<ItemRow> rows = (await grid.ReadAsync<ItemRow>()).ToList();
            items = new Group<ItemResult>(
                rows.Take(limit).Select(ToItemResult).ToList(),
                rows.Count > limit && canPage);
        }

        if (wantMine)
        {
            List<MineRow> rows = (await grid.ReadAsync<MineRow>()).ToList();
            mine = new Group<MineResult>(
                rows.Take(limit).Select(row => new MineResult(row.Kind, row.Id, row.Title)).ToList(),
                rows.Count > limit && canPage);
        }

        return (collections, items, mine);
    }

    private static string BuildCollectionsSql(string tsq)
    {
        // The match set is small (discoverable collections only), so the per-row item count can drive the ranking.
        return $"""
            SELECT m."Id", m."Name", m."Description", m."ItemCount"
            FROM (
                SELECT c."Id", c."Name", c."Description",
                    (SELECT count(*)::int FROM "CollectionItems" ci
                        JOIN "Items" it ON it."Id" = ci."ItemId"
                        WHERE ci."CollectionId" = c."Id" AND it."IsPrivate" = false AND {ItemVisibility.MediaEligibleSql("it")}) AS "ItemCount",
                    ts_rank_cd(c."SearchVector", {tsq}, 32) AS "Rank",
                    word_similarity(lower(@Q), lower(c."Name")) AS "Similarity"
                FROM "Collections" c
                WHERE c."IsPublic" = true AND c."IsDiscoverable" = true
                    AND (@UserId IS NULL OR c."CreatedBy" <> @UserId)
                    AND (c."SearchVector" @@ {tsq} OR lower(@Q) <% lower(c."Name"))
            ) m
            ORDER BY m."Rank" + m."Similarity" * 0.1 + 0.05 * ln(1 + m."ItemCount") DESC, m."Name", m."Id"
            LIMIT @Limit1 OFFSET @Offset;
            """;
    }

    private static string BuildItemsSql(string tsq)
    {
        // ts_headline only runs on the final page of rows, and only on the Question: CorrectAnswer and Explanation
        // count for matching but are never returned. The private-use markers are stripped from the source first so
        // the only U+E000/U+E001 characters in the headline are the ones ts_headline inserted.
        return $"""
            SELECT i."Id",
                ts_headline('english',
                    regexp_replace(i."Question", '[' || chr(57344) || chr(57345) || ']', '', 'g'),
                    {tsq},
                    'StartSel=' || chr(57344) || ', StopSel=' || chr(57345) || ', MaxWords=30, MinWords=10, MaxFragments=0') AS "Headline",
                c."Name" AS "CategoryName",
                c."IsPrivate" AS "CategoryIsPrivate",
                CASE WHEN k1."IsPrivate" = false THEN COALESCE(k1."Slug", lower(k1."Name")) END AS "L1",
                CASE WHEN k2."IsPrivate" = false THEN COALESCE(k2."Slug", lower(k2."Name")) END AS "L2"
            FROM (
                SELECT i0."Id", i0."Question", i0."CategoryId", i0."NavigationKeywordId1", i0."NavigationKeywordId2",
                    ts_rank_cd(i0."SearchVector", {tsq}, 32) AS "Rank"
                FROM "Items" i0
                WHERE i0."IsPrivate" = false AND {ItemVisibility.MediaEligibleSql("i0")} AND i0."SearchVector" @@ {tsq}
                ORDER BY "Rank" DESC, i0."Id"
                LIMIT @Limit1 OFFSET @Offset
            ) i
            LEFT JOIN "Categories" c ON c."Id" = i."CategoryId"
            LEFT JOIN "Keywords" k1 ON k1."Id" = i."NavigationKeywordId1"
            LEFT JOIN "Keywords" k2 ON k2."Id" = i."NavigationKeywordId2"
            ORDER BY i."Rank" DESC, i."Id";
            """;
    }

    private static string BuildMineSql(string tsq)
    {
        return $"""
            SELECT m."Kind", m."Id", m."Title"
            FROM (
                SELECT '{KindCollection}' AS "Kind", c."Id", c."Name" AS "Title",
                    (ts_rank_cd(c."SearchVector", {tsq}, 32) + word_similarity(lower(@Q), lower(c."Name")) * 0.1)::float8 AS "Rank"
                FROM "Collections" c
                WHERE c."CreatedBy" = @UserId
                    AND (c."SearchVector" @@ {tsq} OR lower(@Q) <% lower(c."Name"))
                UNION ALL
                SELECT '{KindStudyGuideDocument}', d."Id", d."Title", 0.1::float8
                FROM "StudyGuideDocuments" d
                WHERE d."UserId" = @UserId AND d."ExpiresUtc" > now()
                    AND d."Title" ILIKE @Like ESCAPE '\'
                UNION ALL
                SELECT '{KindItem}', i."Id", left(i."Question", 200),
                    ts_rank_cd(i."SearchVector", {tsq}, 32)::float8
                FROM "Items" i
                WHERE i."CreatedBy" = @UserId AND i."IsPrivate" = true
                    AND i."SearchVector" @@ {tsq}
            ) m
            ORDER BY m."Rank" DESC, m."Title", m."Id"
            LIMIT @Limit1 OFFSET @Offset;
            """;
    }

    private static ItemResult ToItemResult(ItemRow row)
    {
        Snippet snippet = ParseHeadline(row.Headline ?? string.Empty);
        string? categorySlug = row.CategoryName is null || row.CategoryIsPrivate == true
            ? null
            : CategoryHelper.NameToSlug(row.CategoryName);
        return new ItemResult(row.Id, snippet, categorySlug, row.L1, row.L2);
    }

    /// <summary>
    /// Converts a <c>ts_headline</c> result that marks matches with U+E000 / U+E001 into plain text plus highlight
    /// ranges. Offsets are UTF-16 code unit indices (what JavaScript string indexing uses). Unpaired markers are dropped.
    /// </summary>
    internal static Snippet ParseHeadline(string headline)
    {
        System.Text.StringBuilder text = new(headline.Length);
        List<Highlight> highlights = [];
        int start = -1;
        foreach (char c in headline)
        {
            if (c == HighlightStart)
            {
                start = text.Length;
            }
            else if (c == HighlightEnd)
            {
                if (start >= 0 && text.Length > start)
                {
                    highlights.Add(new Highlight(start, text.Length - start));
                }

                start = -1;
            }
            else
            {
                text.Append(c);
            }
        }

        return new Snippet(text.ToString(), highlights);
    }

    internal static string EscapeLike(string value)
    {
        return value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
    }

    internal static bool TryParseTypes(string? raw, out HashSet<string> types)
    {
        types = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(raw))
        {
            types.UnionWith(AllTypes);
            return true;
        }

        foreach (string part in raw.Split(',', StringSplitOptions.TrimEntries))
        {
            string? match = AllTypes.FirstOrDefault(type => string.Equals(type, part, StringComparison.OrdinalIgnoreCase));
            if (match is null)
            {
                return false;
            }

            types.Add(match);
        }

        return true;
    }

    private static Groups EmptyGroups(HashSet<string> types, bool signedIn)
    {
        return new Groups(
            types.Contains(TypeCategories) ? new Group<CategoryResult>([], false) : null,
            types.Contains(TypeSubcategories) ? new Group<SubcategoryResult>([], false) : null,
            types.Contains(TypeCollections) ? new Group<CollectionResult>([], false) : null,
            types.Contains(TypeItems) ? new Group<ItemResult>([], false) : null,
            types.Contains(TypeMine) && signedIn ? new Group<MineResult>([], false) : null);
    }

    private sealed class CollectionRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public int ItemCount { get; set; }
    }

    private sealed class ItemRow
    {
        public Guid Id { get; set; }
        public string? Headline { get; set; }
        public string? CategoryName { get; set; }
        public bool? CategoryIsPrivate { get; set; }
        public string? L1 { get; set; }
        public string? L2 { get; set; }
    }

    private sealed class MineRow
    {
        public string Kind { get; set; } = string.Empty;
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
    }
}
