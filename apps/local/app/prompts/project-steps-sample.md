## Adding BM25 Search

<!-- VIDEO -->

Let's start by adding BM25 search to the search page.

### Steps To Complete

#### Adding the `okapibm25` package

- [ ] Add the `okapibm25` package to the project

```bash
# Terminal
pnpm add okapibm25
```

#### Creating the `searchWithBM25` function

- [ ] Create a new file called `search.ts` in the `src/app` directory, with a `searchWithBM25` function that takes a list of keywords and a list of emails. This keeps our search logic organized in one place.

<Spoiler>

```typescript
// src/app/search.ts
// ADDED: New function to search emails using BM25 algorithm
export async function searchWithBM25(keywords: string[], emails: Email[]) {
  // Combine subject + body so BM25 searches across both fields
  const corpus = emails.map((email) => `${email.subject} ${email.body}`);

  // BM25 returns score array matching corpus order
  const scores: number[] = (BM25 as any)(corpus, keywords);

  // Map scores to emails, sort descending
  return scores
    .map((score, idx) => ({ score, email: emails[idx] }))
    .sort((a, b) => b.score - a.score);
}
```

</Spoiler>

#### Colocating the Search Functionality

- [ ] Move the existing `loadEmails` function and `Email` interface to the `search.ts` file to keep all search-related code together.

<Spoiler>

```typescript
// src/app/search.ts

// ADDED: Moved from search page for colocation
export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(process.cwd(), "data", "emails.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

// ADDED: Moved from search page for colocation
interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  body: string;
  timestamp: string;
  inReplyTo?: string;
  references?: string[];
  labels?: string[];
  arcId?: string;
  phaseId?: number;
}
```

</Spoiler>

#### Updating the Search Page

- [ ] Let's update the search page to use the new `searchWithBM25` function. First, we'll need to import the `loadEmails` function and the `searchWithBM25` function.

```typescript
// src/app/search/page.tsx

// ADDED: Import new search functions
import { loadEmails, searchWithBM25 } from "../search";
```

- [ ] Update the search page to use `searchWithBM25` instead of the old search logic. This switches to BM25 ranking algorithm.

<Spoiler>

```typescript
// src/app/search/page.tsx

// CHANGED: Use BM25 search instead of previous filtering logic
const emailsWithScores = await searchWithBM25(
  query.toLowerCase().split(" "),
  allEmails
);
```

</Spoiler>

- [ ] Next, we'll need to change some code in `transformedEmails` to use the new `emailsWithScores` array:

<Spoiler>

```typescript
// CHANGED: Map from emailsWithScores instead of allEmails
const transformedEmails = emailsWithScores.map(({ email, score }) => ({
  id: email.id,
  from: email.from,
  subject: email.subject,
  preview: email.body.substring(0, 100) + "...",
  content: email.body,
  date: email.timestamp,
  score: score, // ADDED: Include BM25 score
}));
```

</Spoiler>

- [ ] We'll also need to sort them by score, not date:

<Spoiler>

```typescript
const transformedEmails = emailsWithScores
  .map(({ email, score }) => ({
    id: email.id,
    from: email.from,
    subject: email.subject,
    preview: email.body.substring(0, 100) + "...",
    content: email.body,
    date: email.timestamp,
    score: score,
  }))
  // CHANGED: Sort by BM25 score descending instead of date
  .sort((a, b) => b.score - a.score);
```

</Spoiler>

- [ ] Remove the existing filtering and filter on score instead. This excludes emails with no relevance to the query.

<Spoiler>

```typescript
// CHANGED: Filter by BM25 score instead of string matching
const filteredEmails = query
  ? transformedEmails.filter((email) => email.score > 0)
  : transformedEmails;
```

</Spoiler>

#### Testing

- [ ] You should be able to test the search page by running the development server and searching for a query.

```bash
# Terminal
pnpm dev
```

- [ ] You should see the search results sorted by score, descending!
