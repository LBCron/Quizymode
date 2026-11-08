using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Get;

internal sealed class ItemQueryExecutor
{
    private readonly ApplicationDbContext _db;
    private readonly CancellationToken _cancellationToken;

    public ItemQueryExecutor(
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        _db = db;
        _cancellationToken = cancellationToken;
    }

    public async Task<(int TotalCount, List<Item> Items)> ExecuteQueryAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        bool isRandom = request.IsRandom == true;

        try
        {
            int totalCount = await query.CountAsync(_cancellationToken);

            List<Item> items;
            if (isRandom)
            {
                items = await ExecuteRandomQueryAsync(query, request);
            }
            else
            {
                items = await ExecutePagedQueryAsync(query, request);
            }

            return (totalCount, items);
        }
        catch (Exception ex) when ((ex is NotSupportedException || ex is InvalidOperationException) && !string.IsNullOrEmpty(request.Category))
        {
            return await ExecuteQueryInMemoryAsync(query, request, isRandom);
        }
    }

    private async Task<List<Item>> ExecuteRandomQueryAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        // Pick the random ids in the database, then load only those rows with their keywords;
        // loading the whole scope first took ~5 s for the unscoped pool in production.
        List<Guid> ids = await query
            .AsNoTracking()
            .OrderBy(_ => EF.Functions.Random())
            .Select(i => i.Id)
            .Take(request.PageSize)
            .ToListAsync(_cancellationToken);

        List<Item> items = await _db.Items
            .AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .Include(i => i.ItemKeywords)
                .ThenInclude(ik => ik.Keyword)
            .Include(i => i.Category)
            .AsSplitQuery()
            .ToListAsync(_cancellationToken);

        Dictionary<Guid, int> order = ids.Select((id, index) => (id, index)).ToDictionary(x => x.id, x => x.index);
        return items.OrderBy(i => order[i.Id]).ToList();
    }

    private async Task<List<Item>> ExecutePagedQueryAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        return await query
            .AsNoTracking()
            .Include(i => i.ItemKeywords)
                .ThenInclude(ik => ik.Keyword)
            .Include(i => i.Category)
            // Deterministic paging: creation order with an Id tiebreaker (#490).
            .OrderBy(i => i.CreatedAt)
            .ThenBy(i => i.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(_cancellationToken);
    }

    private async Task<(int TotalCount, List<Item> Items)> ExecuteQueryInMemoryAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request,
        bool isRandom)
    {
        List<Item> allItems = await query
            .AsNoTracking()
            .Include(i => i.ItemKeywords)
                .ThenInclude(ik => ik.Keyword)
            .Include(i => i.Category)
            .ToListAsync(_cancellationToken);

        int totalCount = allItems.Count;

        List<Item> items;
        if (isRandom)
        {
            Random random = new Random();
            items = allItems
                .OrderBy(_ => random.Next())
                .Take(request.PageSize)
                .ToList();
        }
        else
        {
            items = allItems
                .Skip((request.Page - 1) * request.PageSize)
                .Take(request.PageSize)
                .ToList();
        }

        return (totalCount, items);
    }
}
