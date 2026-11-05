# Quizymode User Guide

**App:** [www.quizymode.com](https://www.quizymode.com)

This guide provides an overview of the main screens available to signed-in users on desktop and larger screens.
_Screenshots are generated automatically - run `npx playwright test --project=screenshots --project=screenshots-mobile && node scripts/generate-user-guide.js --all` from the repo root to refresh both guides._

## Table of Contents

- [Home](#home)
- [Featured](#featured)
- [Browsing the Taxonomy](#browsing-the-taxonomy)
- [Building Your Collection](#building-your-collection)
- [Collections](#collections)
- [Adding Items](#adding-items)
- [Other Pages](#other-pages)

## Home

### Home

The home page is the main entry point for Quizymode. Its primary action starts a five-question quiz of quick questions from flags to space to AI, with no account or intermediate page; after each answer a short "Did you know?" card appears, and at the end you can pick what to explore next. Category cards remain available immediately, while featured sets and recently added public collections add more ways to browse when those services are available. The footer provides access to the User Guide, Feedback, Categories Map, and About from anywhere in the app.

![Home](screenshots/user/home.png "Home")

## Featured

## Browsing the Taxonomy

### Categories

The Categories page lists all public subject areas available in Quizymode. You can search categories by name and sort by name, number of items, or average rating. Clicking a category opens its Sets view, where you can drill down through topics and subtopics to find exactly the items you want to study.

![Categories](screenshots/user/categories.png "Categories")

### Nav Geography

Clicking a category card (here: Geography) opens the Sets view for that subject area. Each card represents a primary topic (rank-1 keyword) such as Capitals, Physical Geography, or Flags. The breadcrumb at the top shows your current position in the hierarchy and lets you navigate back at any time.

![Nav Geography](screenshots/user/nav-geography.png "Nav Geography")

### Nav Geography Capitals

Selecting a primary topic (here: Capitals) shows the available subtopics (rank-2 keywords) for that scope such as World, Europe, or Americas. These are the deepest navigable buckets in the hierarchy.

![Nav Geography Capitals](screenshots/user/nav-geography-capitals.png "Nav Geography Capitals")

### Nav Geography Capitals World

Selecting a subtopic (here: World) reaches the leaf level and shows the actual quiz items. At this level the view automatically switches from Sets to **List** mode, showing each question, correct answer, and available actions. You can switch between List, Flashcards, and Quiz modes using the mode buttons at the top.

![Nav Geography Capitals World](screenshots/user/nav-geography-capitals-world.png "Nav Geography Capitals World")

### Mode Flashcards

**Flashcards mode** shows one item at a time as a card. The correct answer is shown first; clicking the card flips it to reveal the question and explanation. Use the arrow controls to move to the next or previous card. This mode is ideal for self-testing with spaced repetition.

![Mode Flashcards](screenshots/user/mode-flashcards.png "Mode Flashcards")

### Mode Quiz

**Quiz mode** presents each item as a multiple-choice question with the correct answer shuffled among the incorrect options. Your first submitted answer is locked for that run, and revisiting a question restores its answer and feedback. After every question is answered, **View results** shows your score and offers mistake review or a replay of the same set.

![Mode Quiz](screenshots/user/mode-quiz.png "Mode Quiz")

## Building Your Collection

### Items Add To Collection

Each item in study views includes collection controls. The folder button shows your current active collection, and the **+** button adds that item to it immediately with no confirmation. On list cards the controls sit to the right; in other study modes they appear beneath the item content.

![Items Add To Collection](screenshots/user/items-add-to-collection.png "Items Add To Collection")

### Items Collection Badges

After adding items to your active collection, those items show a filled collection badge so you can see at a glance what is already included. While an item is already in the active collection, its **+** button is disabled until you remove it or switch to a different active collection.

![Items Collection Badges](screenshots/user/items-collection-badges.png "Items Collection Badges")

### Items Collection Removed

Clicking the **minus icon** removes an item from your active collection immediately. The filled collection badge disappears and the **+** button becomes available again, so you can add the item back later if needed.

![Items Collection Removed](screenshots/user/items-collection-removed.png "Items Collection Removed")

### Active Collection Selector

Your **active collection** is the collection that receives items when you click **+**. From any item, click the folder button or the active collection name beside it to open **Manage Collections**. There you can create another collection, mark it active with the radio button, and then continue adding items into that newly active collection.

![Active Collection Selector](screenshots/user/active-collection-selector.png "Active Collection Selector")

### Collection New

Click **New collection** to create another collection. Give it a name and an optional description, then save. Once created it appears in your collections list and you can set it as the active collection to start adding items to it.

![Collection New](screenshots/user/collection-new.png "Collection New")

### Collections Mine Two

After creating a second collection, the **My Collections** tab shows both cards together. Each card shows the collection name, item count, and action icons for edit, active, copy link, and delete. The active collection uses a filled active icon so you can tell where one-click item adds will go.

![Collections Mine Two](screenshots/user/collections-mine-two.png "Collections Mine Two")

### Keyword Filter

Items in List mode show their keywords as small tags. Clicking a keyword tag instantly filters the list to show only items that share that tag. This is useful for focusing on a specific sub-topic within a broader scope.

![Keyword Filter](screenshots/user/keyword-filter.png "Keyword Filter")

### Item Detail

Clicking the **eye icon** on a list card opens the item detail page. This page shows extra information that is not visible in the regular list, flashcard, or quiz views, such as the full answer block, incorrect options, explanation, source, visibility, created metadata, keywords, and collections.

![Item Detail](screenshots/user/item-detail.png "Item Detail")

### Item Rating Five Stars

On the item detail page, signed-in users can rate an item by clicking one of the five stars. The rating saves immediately; clicking the same star again removes your rating. The row also shows the current average rating and total rating count.

![Item Rating Five Stars](screenshots/user/item-rating-five-stars.png "Item Rating Five Stars")

### Item Comment Added

From the item detail page, the **Comments** button opens a drawer where you can read existing discussion and post your own note without losing your place. After you type a comment and click **Post Comment**, it appears in the thread immediately with your name and timestamp.

![Item Comment Added](screenshots/user/item-comment-added.png "Item Comment Added")

## Collections

### Collections Mine

The **My Collections** tab shows all collections you own once the page finishes loading. Each card displays the collection name, description, item count, and sharing state, along with icon actions to edit it, make it active, copy its link, or delete it. You can also create a new collection from this tab.

![Collections Mine](screenshots/user/collections-mine.png "Collections Mine")

### Collection Detail

Clicking a collection card opens that collection's study page. The page keeps **Collections** as the active navigation area and shows mode tabs for **List**, **Flashcards**, and **Quiz** so you can study the same collection in different ways. Owners can also remove items or manage which collection is currently active from here.

![Collection Detail](screenshots/user/collection-detail.png "Collection Detail")

### Collection Detail Flashcards

Collections support the same **Flashcards** mode as category pages. Each item in the collection is presented as a flip card: answer first, then question and explanation when flipped.

![Collection Detail Flashcards](screenshots/user/collection-detail-flashcards.png "Collection Detail Flashcards")

### Collection Detail Quiz

Collections also support **Quiz** mode: the full playable collection becomes a multiple-choice run with first-answer scoring. After completing the set, you can review missed questions, return to results, or replay the same collection roster.

![Collection Detail Quiz](screenshots/user/collection-detail-quiz.png "Collection Detail Quiz")

### Collection Settings Public

From **My Collections**, click **Edit collection** on a card to open its settings modal. Turning on **Shared with others** and saving makes the collection public: it appears in Discover and anyone with the shareable link can study it. New collections start private by default.

![Collection Settings Public](screenshots/user/collection-settings-public.png "Collection Settings Public")

### Collections Discover Public

Once you make a collection public it immediately appears in the Discover tab alongside the built-in Sample collection. Other users can find it by searching, browse its items, and bookmark it.

![Collections Discover Public](screenshots/user/collections-discover-public.png "Collections Discover Public")

### Collection Bookmark

Clicking the **Bookmark** button on a collection card in Discover saves it to your Bookmarked Collections tab. Bookmarks are personal: they do not affect the collection or its owner. The bookmark button toggles, so clicking it again removes the bookmark.

![Collection Bookmark](screenshots/user/collection-bookmark.png "Collection Bookmark")

### Collections Bookmarked

The **Bookmarked** tab shows all collections you have bookmarked. You can open any of them directly, study their items, or remove the bookmark. This is useful for keeping quick access to public collections you study regularly.

![Collections Bookmarked](screenshots/user/collections-bookmarked.png "Collections Bookmarked")

## Adding Items

### Add Items

The Add Items hub is the central starting point for creating new quiz content. It provides a Topic and tags block where you choose category, primary topic (rank 1), subtopic (rank 2), and optional extra keywords. The same scope is forwarded to whichever creation method you pick. From here you can open the single-item create form, the Import questions flow (paste text or a file), or Upload notes to turn a study guide into a quiz. If you have an active collection, a banner reminds you that newly created items will be added to it automatically.

![Add Items](screenshots/user/add-items.png "Add Items")

### Add Items Prepopulated

When you click the **Add** button while browsing a specific scope in Categories, the Add Items page opens with that scope already filled in: category, primary topic, and subtopic are pre-selected. The first time you visit you will see a brief content compliance notice; after clicking **I understand**, the page stays open with the selected scope ready for you to use.

![Add Items Prepopulated](screenshots/user/add-items-prepopulated.png "Add Items Prepopulated")

### Add New Item

The Create Item form lets you write a single quiz item from scratch. Fill in the question, one correct answer, up to three incorrect answer options, an optional explanation, and a source URL. Category, primary topic, and subtopic are required and must be chosen from the taxonomy. You can add extra keywords. Successfully created items are automatically added to your active collection.

![Add New Item](screenshots/user/add-new-item.png "Add New Item")

### Import Questions

To add many questions at once, open **Create**, choose **Import questions from text or a file** and use the **Paste text** tab. Paste a Quizlet or Anki export, CSV/TSV, or cloze text, check the preview, pick a topic and upload. The AI-assisted Bulk Create page has been retired.

## Other Pages

### About

![About](screenshots/user/about.png "About")

### Feedback

![Feedback](screenshots/user/feedback.png "Feedback")
