## Adding BM25 Search

<!-- VIDEO -->

Let's start by adding BM25 search to the search page.

### Steps To Complete

#### Adding the `okapibm25` package

- [ ] Add the `okapibm25` package to the project

```bash
pnpm add okapibm25
```

#### Creating the `searchWithBM25` function

- [ ] Next, create a new file called `search.ts` in the `src/app` directory, with a `searchWithBM25` function that takes a list of keywords and a list of emails.

<Spoiler>

```typescript
// src/app/search.ts
export async function searchWithBM25(keywords: string[], emails: Email[]) {
  // Combine subject + body for richer text corpus
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

- [ ] Let's take the existing `loadEmails` function, and the `Email` interface, and move them to the `search.ts` file.

<Spoiler>

```typescript
// src/app/search.ts

export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(
    process.cwd(),
    'data',
    'emails.json',
  );
  const fileContent = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(fileContent);
}

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

import { loadEmails, searchWithBM25 } from '../search';
```

- [ ] Next, let's update the search page to use the new `searchWithBM25` function. We'll need to call the function with the query and the list of emails.

<Spoiler>

```typescript
// src/app/search/page.tsx

const emailsWithScores = await searchWithBM25(
  query.toLowerCase().split(' '),
  allEmails,
);
```

</Spoiler>

- [ ] Next, we'll need to change some code in `transformedEmails` to use the new `emailsWithScores` array:

<Spoiler>

```typescript
const transformedEmails = emailsWithScores.map(
  ({ email, score }) => ({
    id: email.id,
    from: email.from,
    subject: email.subject,
    preview: email.body.substring(0, 100) + '...',
    content: email.body,
    date: email.timestamp,
    score: score,
  }),
);
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
    preview: email.body.substring(0, 100) + '...',
    content: email.body,
    date: email.timestamp,
    score: score,
  }))
  // Sorted by score, descending
  .sort((a, b) => b.score - a.score);
```

</Spoiler>

- [ ] Finally, we'll need to remove the existing filtering, and just filter on the score:

<Spoiler>

```typescript
const filteredEmails = query
  ? transformedEmails.filter((email) => email.score > 0)
  : transformedEmails;
```

</Spoiler>

#### Testing

- [ ] You should be able to test the search page by running the development server and searching for a query.

```bash
pnpm dev
```

- [ ] You should see the search results sorted by score, descending!
