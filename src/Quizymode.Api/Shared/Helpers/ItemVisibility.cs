using System.Linq.Expressions;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>
/// Single source of truth for who may see an item (#285).
/// Visibility (lists, review queue): public, or created by the caller.
/// Access by id: visibility, or the caller is an admin.
/// Media eligibility (#400, AC 3.25): an item whose uploaded pictures are not Approved is hidden from everyone except
/// its creator (and admins by id), so a picture is never reachable through any path before it is reviewed.
/// </summary>
internal static class ItemVisibility
{
    /// <summary>No uploaded pictures, or the uploaded pictures are Approved.</summary>
    public static bool IsMediaEligible(Item item) =>
        item.ImageReviewState is null or ItemImageReviewState.Approved;

    /// <summary>Public and media-eligible: what an anonymous caller may see.</summary>
    public static Expression<Func<Item, bool>> PublicEligible { get; } =
        i => !i.IsPrivate && (i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved);

    /// <summary>Media-eligible regardless of visibility; combine with another visibility rule.</summary>
    public static Expression<Func<Item, bool>> MediaEligible { get; } =
        i => i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved;

    /// <summary>
    /// For paths that skip item visibility (a collection the caller can open): the creator, or media-eligible.
    /// </summary>
    public static Expression<Func<Item, bool>> EligibleFor(string? userId)
    {
        string callerId = userId ?? string.Empty;
        bool hasCaller = callerId.Length > 0;
        return i => (hasCaller && i.CreatedBy == callerId)
            || i.ImageReviewState == null
            || i.ImageReviewState == ItemImageReviewState.Approved;
    }

    /// <summary>
    /// Collection membership rows minus those whose item exists but is hidden from the caller by media eligibility; rows with no
    /// item row are kept, as before. Use for item counts of a collection.
    /// </summary>
    public static IQueryable<CollectionItem> EligibleCollectionItems(ApplicationDbContext db, string? userId)
    {
        string callerId = userId ?? string.Empty;
        bool hasCaller = callerId.Length > 0;
        return db.CollectionItems.Where(ci => !db.Items.Any(i =>
            i.Id == ci.ItemId
            && !(hasCaller && i.CreatedBy == callerId)
            && i.ImageReviewState != null
            && i.ImageReviewState != ItemImageReviewState.Approved));
    }

    /// <summary>Raw SQL equivalent of <see cref="MediaEligible"/> for the item table alias <paramref name="alias"/>.</summary>
    public static string MediaEligibleSql(string alias) =>
        $"({alias}.\"ImageReviewState\" IS NULL OR {alias}.\"ImageReviewState\" = 'Approved')";

    public static bool IsVisibleTo(Item item, string? userId) =>
        (!item.IsPrivate && IsMediaEligible(item)) || (!string.IsNullOrEmpty(userId) && item.CreatedBy == userId);

    public static bool CanAccessById(Item item, IUserContext userContext) =>
        userContext.IsAdmin || IsVisibleTo(item, CallerId(userContext));

    public static Expression<Func<Item, bool>> VisibleTo(string? userId)
    {
        string callerId = userId ?? string.Empty;
        bool hasCaller = callerId.Length > 0;
        return i => (!i.IsPrivate && (i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved))
            || (hasCaller && i.CreatedBy == callerId);
    }

    public static Expression<Func<Item, bool>> AccessibleById(IUserContext userContext)
    {
        string callerId = CallerId(userContext) ?? string.Empty;
        bool hasCaller = callerId.Length > 0;
        bool isAdmin = userContext.IsAdmin;
        return i => isAdmin
            || (!i.IsPrivate && (i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved))
            || (hasCaller && i.CreatedBy == callerId);
    }

    /// <summary>
    /// Items a caller may add to their own collection: visible to them, or published by the item's
    /// creator through one of the creator's own public collections. No admin exception. Items with unapproved
    /// uploaded pictures are addable only by their creator.
    /// </summary>
    public static IQueryable<Item> AddableToCollection(ApplicationDbContext db, string? userId)
    {
        string callerId = userId ?? string.Empty;
        bool hasCaller = callerId.Length > 0;
        return db.Items.Where(i =>
            (hasCaller && i.CreatedBy == callerId)
            || ((i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved)
                && (!i.IsPrivate
                    || (from ci in db.CollectionItems
                        join c in db.Collections on ci.CollectionId equals c.Id
                        where ci.ItemId == i.Id && c.IsPublic && c.CreatedBy == i.CreatedBy
                        select ci.Id).Any())));
    }

    /// <summary>
    /// Items a caller may read or write comments and ratings on (#293): accessible by id (admin, public, own),
    /// or published through a public collection owned by the item's creator.
    /// </summary>
    public static IQueryable<Item> InteractableBy(ApplicationDbContext db, IUserContext userContext) =>
        userContext.IsAdmin ? db.Items : AddableToCollection(db, CallerId(userContext));

    private static string? CallerId(IUserContext userContext) =>
        userContext.IsAuthenticated ? userContext.UserId : null;
}
