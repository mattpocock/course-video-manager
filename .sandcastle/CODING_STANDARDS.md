Wherever possible, use Effect primitives like `FileSystem` over promises. This is so that we can make use of DI and type-safe errors from Effect. However, Effect should not leak out into the user-facing API.

---

Optional parameters passed to functions should be scrutinised extremely carefully. They are a huge source of bugs (by omission). Prioritise correctness over backwards compatibility.

---

All files in `./app/routes` will be exposed publicly as routes. Do not include test files or utility files there.

---

Context menu items should always include a leading icon (from `lucide-react`), matching the style of the surrounding items. When adding a new menu item, pick an icon that conveys the action.

---

Filters must stay in sync with the shape of the data they filter. When a new field is added to an entity that affects what something "is" (status, category, state), every filter, count, and badge that surfaces that concept must be updated to take the new field into account. Filters are part of the entity's definition, not a one-time UI feature — drift between them and the data shape produces silently-wrong results.

---

When a fetcher action's sole job after success is to navigate, return `redirect(...)` from the action instead of returning data and navigating from a client-side `useEffect`. React Router handles fetcher redirects automatically. The `useEffect` pattern is fragile: if any dep (e.g. an inline `onOpenChange` prop) changes between renders, the effect re-fires and re-issues `navigate(...)`, cancelling and restarting the in-flight navigation in a loop.

---

For optimistic UI on fetcher mutations, derive the optimistic value from `fetcher.formData` instead of mirroring it into `useState` + syncing back with `useEffect`. When the fetcher is in-flight, `fetcher.formData.get("value")` holds the pending value; when it settles, `formData` becomes `undefined` and the component falls back to the revalidated loader data. Example: `const optimistic = (fetcher.formData?.get("value") ?? loaderValue) as MyType;`. This eliminates state-sync bugs and removes the need for `useEffect` entirely.

---

## Testing

### Core Principle

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't break unless behavior changed.

### Good Tests

Integration-style tests that exercise real code paths through public APIs. They describe _what_ the system does, not _how_.

```typescript
// GOOD: Tests observable behavior through the public interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

- Test behavior users/callers care about
- Use the public API only
- Survive internal refactors
- One logical assertion per test

### Bad Tests

```typescript
// BAD: Mocks internal collaborator, tests HOW not WHAT
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});

// BAD: Bypasses the interface to verify via database
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});
```

```typescript
// BAD: Test restates the implementation — the function IS the spec
test("pitchHref includes from param", () => {
  expect(pitchHref("abc")).toBe("/pitches/abc?from=deliverables");
});
```

Red flags:

- Mocking internal collaborators (your own classes/modules)
- Testing private methods
- Asserting on call counts/order of internal calls
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means (e.g. querying a DB) instead of through the interface
- Testing a trivial function (one-liner, simple mapping, string concatenation) where the test just mirrors the code — these tests add no confidence and break on any refactor
- Thin delegation tests for route handlers — when a route's only job is to parse input and call a service method, testing that it "delegates correctly" by mocking the service duplicates the route code in the test. The real behavior lives in the service; test that instead.

### Mocking

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Time/randomness
- File system or databases when a real instance isn't practical

**Never mock your own classes/modules or internal collaborators.** If something is hard to test without mocking internals, redesign the interface.

Prefer SDK-style interfaces over generic fetchers at boundaries — each function is independently mockable with a single return shape, no conditional logic in test setup.

### TDD Workflow: Vertical Slices

Do NOT write all tests first, then all implementation. That produces tests that verify _imagined_ behavior and are insensitive to real changes.

Correct approach — one test, one implementation, repeat:

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
RED→GREEN: test3→impl3
```

Each test responds to what you learned from the previous cycle. Never refactor while RED — get to GREEN first.

## Interface Design

### Deep Modules

Prefer deep modules: small interface, deep implementation. A few methods with simple params hiding complex logic behind them.

Avoid shallow modules: large interface with many methods that just pass through to thin implementation. When designing, ask: can I reduce the number of methods? Can I simplify the parameters? Can I hide more complexity inside?

### Design for Testability

1. **Accept dependencies, don't create them** — pass external dependencies in rather than constructing them internally.
2. **Return results, don't produce side effects** — a function that returns a value is easier to test than one that mutates state.
3. **Small surface area** — fewer methods = fewer tests needed, fewer params = simpler test setup.

---

## localStorage

Use `useLocalStorage` from `@/hooks/use-local-storage` for component state that should persist in `localStorage`. The hook handles SSR guards, initialization from a stored value with a fallback, and auto-saves on every change. Avoid raw `localStorage.getItem`/`setItem` scattered across components.
