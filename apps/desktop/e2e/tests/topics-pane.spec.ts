/**
 * Topics Pane E2E Tests
 *
 * House rules for this file:
 *   - open the pane through `ensurePaneOpen`, which creates it deterministically
 *     from the New Tab page instead of hoping a topic link exists. The Study
 *     Pane renders its topic rows as `<a>` anchors, not buttons, so a helper
 *     that hunts for buttons finds nothing;
 *   - assert unconditionally - a missing element must fail;
 *   - address elements by `data-testid` rather than by inline-style fragments
 *     like `[style*="cursor: pointer"]`;
 *   - name fixtures ("Paul" has 111 sub-topics in Nave's; "Faith" and "Prayer"
 *     appear in both Nave's and Torrey's) instead of clicking whatever happens
 *     to be first;
 *   - `test.skip` the tag-graph cases with a visible reason, because
 *     `data/tag_graph.db` is not part of the dev dataset. A skip shows up in the
 *     report; a silent `return` does not.
 */

import { test, expect, Page } from '../fixtures/electron.fixture';
import { selectVerse, ensurePaneOpen } from '../fixtures/test-utils';

/**
 * Fixtures, chosen against the dev dataset and qualified by source.
 *
 * Both halves are needed: topic names are not unique. Nave's has three topics
 * called "Paul" - one root with 111 children and two childless leaves - so a
 * test that searched "Paul" and took the first hit was liable to land on a leaf
 * and then fail looking for sub-topics. "Levites" is unique within Nave's and
 * absent from Torrey's; "Faith" exists once in each index, which is exactly what
 * gives it an "Also in" cross-link.
 */
const NAVES = 'Nave';
const TORREYS = 'Torrey';
/**
 * 54 sub-topics in Nave's, not present in Torrey's. Nave's holds a *second*
 * childless "Levites" nested under Israel, so callers that need the children
 * pass `requireSubTopics` - see `openTopic`.
 */
const TOPIC_WITH_CHILDREN = { name: 'Levites', source: NAVES };
/** One in each index, so its detail view carries an "Also in" cross-link. */
const TOPIC_IN_BOTH_INDEXES = { name: 'Faith', source: TORREYS };

/** The tag graph ships separately; these cases cannot run without it. */
const TAG_GRAPH_AVAILABLE = false;

/**
 * Every lookup is scoped to the Topics pane. `PaneNavHeader` and
 * `TopicSearchBar` are shared components - the Study pane renders its own
 * back/forward buttons and its own topic search box - so an unscoped
 * `getByTestId` is a strict-mode violation the moment both panes are mounted.
 */
const pane = (window: Page) => window.getByTestId('topics-pane');
const topicName = (window: Page) => pane(window).getByTestId('topic-name');
const searchInput = (window: Page) => pane(window).getByTestId('topic-search-input').first();
const searchResults = (window: Page) => pane(window).getByTestId('topic-search-results');
const navBack = (window: Page) => pane(window).getByTestId('pane-nav-back');
const navForward = (window: Page) => pane(window).getByTestId('pane-nav-forward');

/**
 * Bring the app's original Bible pane back to the front.
 *
 * Not `ensurePaneOpen(window, 'Bible')`: the Bible tab is titled with its
 * passage - "John 3" on a fresh profile, see default-layout.spec.ts - so a
 * lookup for a tab reading "Bible" finds nothing and opens a second, empty
 * Bible pane instead of revealing the one already there.
 */
async function showBiblePane(window: Page): Promise<void> {
  const tab = window.locator('.dockview-tab-content').filter({ hasText: /John\s*3/ }).first();
  await expect(tab).toBeVisible({ timeout: 15000 });
  await tab.click({ force: true });
  await expect(window.locator('[data-testid="bible-pane"]').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Type into the topic search box and wait for the debounced results.
 *
 * The results render inline, in the list beneath the box, rather than in a
 * dropdown over it - see the Browse view tests below for why.
 */
async function searchTopics(window: Page, query: string): Promise<void> {
  await searchInput(window).fill(query);
  await expect(searchResults(window)).toBeVisible({ timeout: 10000 });
}

/**
 * Search for a topic and open the result whose name matches `query` exactly,
 * landing on the detail view.
 *
 * Exact, because the search is FTS and stems: "Paul" also returns "Paul's
 * Companions", and taking whichever came back first is how a test ends up
 * asserting about a topic other than the one it named.
 *
 * A name is *not* unique within one index, though. Nave's carries two topics
 * called "Levites" - one nested under Israel, one at the root with the 54
 * sub-topics - and which entries a module holds changes when it is rebuilt (the
 * `.db` files are not in git; see the topical import scripts). So this asserts
 * "at least one" rather than "exactly one", and `requireSubTopics` says which
 * of several same-named entries the caller actually meant.
 */
async function openTopic(
  window: Page,
  topic: { name: string; source: string },
  options: { requireSubTopics?: boolean } = {},
): Promise<string> {
  await searchTopics(window, topic.name);
  const exact = searchResults(window)
    .getByTestId('topic-list-item')
    .filter({ has: window.getByTestId('topic-list-item-name').and(window.getByText(topic.name, { exact: true })) })
    .filter({ hasText: topic.source });
  await expect(exact.first()).toBeVisible({ timeout: 10000 });

  const matches = await exact.count();
  for (let i = 0; i < matches; i++) {
    await exact.nth(i).click({ force: true });
    await expect(topicName(window)).toHaveText(topic.name, { timeout: 10000 });
    if (!options.requireSubTopics) return topic.name;

    const subTopics = pane(window).getByTestId('topic-subtopics');
    if (await subTopics.isVisible()) return topic.name;

    // Wrong "Levites": back to the results and try the next one.
    if (i < matches - 1) await searchTopics(window, topic.name);
  }

  throw new Error(
    `No "${topic.name}" result in ${topic.source} has sub-topics (${matches} exact matches tried)`,
  );
}

test.describe('Topics Pane', () => {
  test.beforeEach(async ({ window }) => {
    await ensurePaneOpen(window, 'Topics');
    await expect(pane(window)).toBeVisible({ timeout: 15000 });
  });

  test.describe('Browse view', () => {
    /**
     * One box does both jobs here - typeahead and filtering the full list of
     * topics across every index - and its results land in the list beneath it.
     */
    test('lists top-level topics with one search box and source chips', async ({ window }) => {
      const browse = pane(window).getByTestId('topic-browse-view');
      await expect(browse).toBeVisible();
      await expect(searchInput(window)).toBeVisible();
      await expect(pane(window).getByTestId('topic-browse-filter')).toHaveCount(0);

      // Both Nave's and Torrey's are installed, so the source chips render.
      await expect(pane(window).getByTestId('topic-source-filter')).toHaveCount(2);

      // The list itself must actually have topics in it, and it is the browse
      // list - not search results - while the box is empty.
      await expect(browse.getByTestId('topic-browse-results')).toBeVisible({ timeout: 15000 });
      await expect(browse.getByTestId('topic-list-item').first()).toBeVisible({ timeout: 15000 });
    });

    test('replaces the list with search results as the reader types', async ({ window }) => {
      const browse = pane(window).getByTestId('topic-browse-view');
      await expect(browse.getByTestId('topic-list-item').first()).toBeVisible({ timeout: 15000 });

      await searchInput(window).fill('faith');
      await expect(browse.getByTestId('topic-search-results')).toBeVisible({ timeout: 10000 });
      await expect(browse.getByTestId('topic-browse-results')).toHaveCount(0);

      const names = browse.getByTestId('topic-list-item-name');
      await expect(names.first()).toBeVisible({ timeout: 10000 });
      // FTS stems, so assert on the stem rather than the literal query.
      for (const text of await names.allTextContents()) {
        expect(text.toLowerCase()).toMatch(/fait/);
      }
    });

    test('brings the browse list back when the box is cleared', async ({ window }) => {
      const browse = pane(window).getByTestId('topic-browse-view');
      await searchInput(window).fill('faith');
      await expect(browse.getByTestId('topic-search-results')).toBeVisible({ timeout: 10000 });

      await searchInput(window).fill('');

      await expect(browse.getByTestId('topic-browse-results')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Topic search', () => {
    test('finds topics across both indexes', async ({ window }) => {
      await searchTopics(window, 'love');

      // FTS stems, so "love" legitimately returns "Loving" too - assert on the
      // stem rather than the literal query, and on the topic name rather than
      // the whole row (which also carries the parent path and source).
      const names = searchResults(window).getByTestId('topic-list-item-name');
      await expect(names.first()).toBeVisible();
      const texts = await names.allTextContents();
      expect(texts.length).toBeGreaterThan(0);
      for (const text of texts) {
        expect(text.toLowerCase()).toMatch(/lov/);
      }

      // Both indexes should be represented in a search this common.
      const rows = await searchResults(window).getByTestId('topic-list-item').allTextContents();
      // Matched on the stem: Nave's full title is "Naveߴs Topical Bible",
      // whose apostrophe is not the ASCII one.
      expect(rows.some(r => r.includes(NAVES))).toBe(true);
      expect(rows.some(r => r.includes(TORREYS))).toBe(true);
    });

    test('opens the topic detail when a result is clicked', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      await expect(pane(window).getByTestId('topic-verse-count')).toHaveText(/\d+ verses/);
      // Which of the two indexes this entry belongs to. "Faith" exists in
      // both and they say different things, so the detail view has to name it.
      await expect(pane(window).getByTestId('topic-source')).toContainText(TORREYS);
    });
  });

  test.describe('Topic detail', () => {
    test('shows the verses for a topic and navigates to one', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      const verses = pane(window).getByTestId('topic-verses');
      await expect(verses).toBeVisible({ timeout: 10000 });
      const refs = verses.getByTestId('verse-ref-link');
      await expect(refs.first()).toBeVisible();

      // A verse reference must actually move the Bible pane, not just look
      // clickable - this is the whole point of the topical index.
      //
      // Asserted through the dockview tab titles rather than the Bible pane's
      // own heading: the Bible pane is behind the Topics tab in the same group
      // and dockview unmounts what it hides, so `bible-chapter-heading` is not
      // in the DOM at all here. The tab strip always is, and the Bible tab is
      // titled with its passage - "John 3" on a fresh profile - so the title
      // changing *is* the navigation.
      const tabTitles = () => window.locator('.dockview-tab-content').allTextContents();
      const before = (await tabTitles()).join(' | ');
      expect(before).toMatch(/John\s*3/);

      const reference = (await refs.first().textContent())?.trim() ?? '';
      expect(reference.length).toBeGreaterThan(0);
      await refs.first().click({ force: true });

      await expect.poll(async () => (await tabTitles()).join(' | '), { timeout: 15000 }).not.toBe(before);
    });

    test('shows "Also in" links for a topic carried by both indexes', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      const alsoIn = pane(window).getByTestId('topic-also-in');
      await expect(alsoIn).toBeVisible({ timeout: 10000 });
      await expect(alsoIn.getByTestId('topic-also-in-link').first()).toBeVisible();
    });

    test('follows an "Also in" link to the other index', async ({ window }) => {
      const original = await openTopic(window, TOPIC_IN_BOTH_INDEXES);
      const alsoIn = pane(window).getByTestId('topic-also-in');
      await expect(alsoIn).toBeVisible({ timeout: 10000 });

      await alsoIn.getByTestId('topic-also-in-link').first().click({ force: true });

      // Same topic name, reached through the other source.
      await expect(topicName(window)).toHaveText(original.trim(), { timeout: 10000 });
    });

    test('lists sub-topics for a topic that has them', async ({ window }) => {
      await openTopic(window, TOPIC_WITH_CHILDREN, { requireSubTopics: true });

      const subTopics = pane(window).getByTestId('topic-subtopics');
      await expect(subTopics).toBeVisible({ timeout: 10000 });
      await expect(subTopics.getByTestId('topic-card').first()).toBeVisible();
    });
  });

  test.describe('Drill-down and navigation', () => {
    /** Open a topic with children and click into the first one. */
    async function drillIntoChild(window: Page): Promise<{ parent: string; child: string }> {
      const parent = (await openTopic(window, TOPIC_WITH_CHILDREN, { requireSubTopics: true })).trim();
      const subTopics = pane(window).getByTestId('topic-subtopics');
      await expect(subTopics).toBeVisible({ timeout: 10000 });

      await subTopics.getByTestId('topic-card').first().click({ force: true });
      await expect(topicName(window)).not.toHaveText(parent, { timeout: 10000 });
      const child = (await topicName(window).textContent())?.trim() ?? '';
      return { parent, child };
    }

    test('shows a breadcrumb back to the parent topic', async ({ window }) => {
      const { parent } = await drillIntoChild(window);

      const breadcrumb = pane(window).getByTestId('topic-breadcrumb');
      await expect(breadcrumb).toBeVisible({ timeout: 10000 });
      await expect(breadcrumb.getByTestId('topic-breadcrumb-link').filter({ hasText: parent })).toHaveCount(1);
    });

    test('navigates back to the parent through the breadcrumb', async ({ window }) => {
      const { parent } = await drillIntoChild(window);

      await window
        .getByTestId('topic-breadcrumb')
        .getByTestId('topic-breadcrumb-link')
        .filter({ hasText: parent })
        .first()
        .click({ force: true });

      await expect(topicName(window)).toHaveText(parent, { timeout: 10000 });
    });

    test('goes back and forward through the pane history', async ({ window }) => {
      const { parent, child } = await drillIntoChild(window);

      await navBack(window).click({ force: true });
      await expect(topicName(window)).toHaveText(parent, { timeout: 10000 });

      await navForward(window).click({ force: true });
      await expect(topicName(window)).toHaveText(child, { timeout: 10000 });
    });

    test('disables back until there is somewhere to go back to', async ({ window }) => {
      await expect(navBack(window)).toBeDisabled();
      await expect(navForward(window)).toBeDisabled();

      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      await expect(navBack(window)).toBeEnabled();
    });
  });

  test.describe('Pin', () => {
    test('stops the pane following the Bible selection', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);
      const pinned = (await topicName(window).textContent())?.trim() ?? '';

      const pinButton = window.locator('button[title*="Pin" i]').first();
      await expect(pinButton).toBeVisible();
      await pinButton.click({ force: true });

      await showBiblePane(window);
      expect(await selectVerse(window, 5)).toBe(true);
      await ensurePaneOpen(window, 'Topics');

      // Pinned means no "See topics for ..." offer and no change of topic.
      await expect(pane(window).getByTestId('suggestion-banner')).toHaveCount(0);
      await expect(topicName(window)).toHaveText(pinned);
    });
  });

  test.describe('From the Study Pane', () => {
    test('a topic link opens the Topics Pane on that topic', async ({ window }) => {
      await showBiblePane(window);
      expect(await selectVerse(window, 1)).toBe(true);
      await ensurePaneOpen(window, 'Study');

      const topicLink = window.getByTestId('study-topic-link').first();
      await expect(topicLink).toBeVisible({ timeout: 15000 });
      const linked = (await topicLink.textContent())?.trim() ?? '';

      await topicLink.click({ force: true });

      await expect(pane(window)).toBeVisible({ timeout: 10000 });
      await expect(topicName(window)).toHaveText(linked, { timeout: 10000 });
    });
  });

  test.describe('Tag graph', () => {
    test.skip(!TAG_GRAPH_AVAILABLE, 'data/tag_graph.db is not part of the dev dataset');

    test('shows the Related section with entity categories', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      const section = pane(window).getByTestId('topic-tag-graph');
      await expect(section).toBeVisible({ timeout: 10000 });
      await expect(section.getByTestId('tag-graph-category-label').first()).toBeVisible();
      await expect(pane(window).getByTestId('view-entity')).toBeVisible();
    });

    test('opens the entity detail from "View entity"', async ({ window }) => {
      await openTopic(window, TOPIC_IN_BOTH_INDEXES);

      await pane(window).getByTestId('view-entity').click({ force: true });

      await expect(pane(window).getByTestId('entity-detail')).toBeVisible({ timeout: 10000 });
      await expect(pane(window).getByTestId('entity-name')).not.toBeEmpty();
      await expect(pane(window).getByTestId('entity-category')).toBeVisible();
    });
  });
});
