## Steps To Complete

- [ ] Navigate to `api/create-embeddings.ts` and locate the `embedLotsOfText` function

```ts
const embedLotsOfText = async (
  emails: Email[]
): Promise<
  {
    id: string;
    embedding: number[];
  }[]
> => {
  // TODO: Implement this function by using the embedMany function
  throw new Error("Not implemented");
};
```

- [ ] Use the [`embedMany`](https://ai-sdk.dev/docs/reference/ai-sdk-core/embed-many) function from the AI SDK to create embeddings for multiple emails at once

  - Pass `myEmbeddingModel` as the model parameter (feel free to choose a different model)
  - Pass an array of strings as the `values` parameter - combine each email's `subject` and `body` fields
  - Set `maxRetries` to `0` (this will let us know early if the embedding fails)

- [ ] Map the results to return an array of objects containing each email's `id` and its `embedding`. This will be used to lookup the embedding for each email later.

- [ ] Locate the `embedOnePieceOfText` function in `api/create-embeddings.ts`

```ts
const embedOnePieceOfText = async (text: string): Promise<number[]> => {
  // TODO: Implement this function by using the embed function
};
```

- [ ] Use the [`embed`](https://ai-sdk.dev/docs/reference/ai-sdk-core/embed) function from the AI SDK to create an embedding for a single piece of text

  - Pass `myEmbeddingModel` as the model parameter
  - Pass the `text` parameter as the `value`
  - Return the `embedding` from the result

- [ ] Locate the `calculateScore` function in `api/create-embeddings.ts`

```ts
const calculateScore = (
  queryEmbedding: number[],
  embedding: number[]
): number => {
  // TODO: Implement this function by using the cosineSimilarity function
};
```

- [ ] Use the [`cosineSimilarity`](https://ai-sdk.dev/docs/reference/ai-sdk-core/cosine-similarity) function from the AI SDK to compare the two embeddings

  - Pass `queryEmbedding` as the first parameter
  - Pass `embedding` as the second parameter
  - Return the similarity score from the result

- [ ] Navigate to `api/chat.ts` and locate the first TODO comment

```ts
// TODO: call the searchEmails function with the
// conversation history to get the search results
const searchResults = TODO;
```

- [ ] Call the `searchEmails` function with the formatted message history

  - Use `formatMessageHistory(messages)` to convert the messages array into a string query
  - This will embed the entire conversation and search for relevant emails

- [ ] Locate the second TODO comment

```ts
// TODO: take the top X search results
const topSearchResults = TODO;
```

- [ ] Use the `.slice()` method to get the top 5 search results from the `searchResults` array

- [ ] Run the application using `pnpm run dev`

  - The server will first embed all emails (this may take a moment on first run)
  - Watch for "Embedding Emails" and "Embedding complete" messages in the terminal

- [ ] Open your browser to `localhost:3000`

- [ ] Test the default query "What was Sarah looking for in a house?"

  - Check the browser console to see which emails were returned
  - Verify that relevant emails about Sarah's house search appear in the results

- [ ] Add console logs to see the search results and their scores

```ts
console.log(
  topSearchResults.map((result) => `${result.email.subject} (${result.score})`)
);
```

- [ ] Try different queries to test semantic search capabilities
  - Try queries that don't use exact keywords from the emails
  - Verify that semantically similar emails are returned even without keyword matches
