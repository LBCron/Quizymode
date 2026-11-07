using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data;

public sealed class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<Item> Items => Set<Item>();

    public DbSet<Request> Requests => Set<Request>();

    public DbSet<FeedbackSubmission> FeedbackSubmissions => Set<FeedbackSubmission>();

    public DbSet<Rating> Ratings => Set<Rating>();

    public DbSet<Comment> Comments => Set<Comment>();

    public DbSet<Collection> Collections => Set<Collection>();

    public DbSet<CollectionItem> CollectionItems => Set<CollectionItem>();

    public DbSet<CollectionBookmark> CollectionBookmarks => Set<CollectionBookmark>();

    public DbSet<CollectionShare> CollectionShares => Set<CollectionShare>();

    public DbSet<CollectionRating> CollectionRatings => Set<CollectionRating>();

    public DbSet<Idea> Ideas => Set<Idea>();

    public DbSet<IdeaComment> IdeaComments => Set<IdeaComment>();

    public DbSet<IdeaRating> IdeaRatings => Set<IdeaRating>();

    public DbSet<User> Users => Set<User>();

    public DbSet<UserPolicyAcceptance> UserPolicyAcceptances => Set<UserPolicyAcceptance>();

    public DbSet<Audit> Audits => Set<Audit>();

    public DbSet<PageView> PageViews => Set<PageView>();

    public DbSet<AnalyticsEvent> AnalyticsEvents => Set<AnalyticsEvent>();

    public DbSet<ClientError> ClientErrors => Set<ClientError>();
    public DbSet<AnalyticsSession> AnalyticsSessions => Set<AnalyticsSession>();
    public DbSet<PageViewDailyRollup> PageViewDailyRollups => Set<PageViewDailyRollup>();

    public DbSet<StudySession> StudySessions => Set<StudySession>();

    public DbSet<StudySessionMissedItem> StudySessionMissedItems => Set<StudySessionMissedItem>();

    public DbSet<Keyword> Keywords => Set<Keyword>();

    public DbSet<ItemKeyword> ItemKeywords => Set<ItemKeyword>();

    public DbSet<Category> Categories => Set<Category>();

    public DbSet<KeywordRelation> KeywordRelations => Set<KeywordRelation>();

    public DbSet<SeedSyncRun> SeedSyncRuns => Set<SeedSyncRun>();

    public DbSet<SeedSyncItemHistory> SeedSyncItemHistories => Set<SeedSyncItemHistory>();

    public DbSet<UserSetting> UserSettings => Set<UserSetting>();

    public DbSet<Upload> Uploads => Set<Upload>();

    public DbSet<StudyGuideDocument> StudyGuideDocuments => Set<StudyGuideDocument>();

    public DbSet<StudyGuideSection> StudyGuideSections => Set<StudyGuideSection>();

    public DbSet<SectionGeneration> SectionGenerations => Set<SectionGeneration>();

    public DbSet<GenerationCandidate> GenerationCandidates => Set<GenerationCandidate>();

    public DbSet<StudyGuideQuotaCharge> StudyGuideQuotaCharges => Set<StudyGuideQuotaCharge>();

    public DbSet<StudyGuideAcceptedCandidate> StudyGuideAcceptedCandidates => Set<StudyGuideAcceptedCandidate>();

    public DbSet<LlmProviderSettings> LlmProviderSettings => Set<LlmProviderSettings>();

    public DbSet<LlmAttempt> LlmAttempts => Set<LlmAttempt>();

    public DbSet<LlmModelFinding> LlmModelFindings => Set<LlmModelFinding>();

    public DbSet<FeaturedItem> FeaturedItems => Set<FeaturedItem>();

    public DbSet<ReviewQueueEntry> ReviewQueueEntries => Set<ReviewQueueEntry>();

    public DbSet<DailyQuizSet> DailyQuizSets => Set<DailyQuizSet>();

    public DbSet<DailyQuizItem> DailyQuizItems => Set<DailyQuizItem>();

    public DbSet<DailyQuizCompletion> DailyQuizCompletions => Set<DailyQuizCompletion>();

    public DbSet<UserInterest> UserInterests => Set<UserInterest>();

    public DbSet<StudyPlan> StudyPlans => Set<StudyPlan>();

    internal DbSet<MediaIngressAttempt> MediaIngressAttempts => Set<MediaIngressAttempt>();

    public DbSet<MediaUploadAttempt> MediaUploadAttempts => Set<MediaUploadAttempt>();
    public DbSet<MediaAdvisoryJob> MediaAdvisoryJobs => Set<MediaAdvisoryJob>();
    public DbSet<MediaUploadClaim> MediaUploadClaims => Set<MediaUploadClaim>();
    public DbSet<MediaReport> MediaReports => Set<MediaReport>();
    public DbSet<MediaControl> MediaControls => Set<MediaControl>();

    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();

    public DbSet<ItemImageReview> ItemImageReviews => Set<ItemImageReview>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ApplicationDbContext).Assembly);
        
        base.OnModelCreating(modelBuilder);
    }
}

