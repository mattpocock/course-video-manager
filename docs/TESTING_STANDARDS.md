# Testing standards

The worked examples behind the testing rules in
[`CODING_STANDARDS.md`](../CODING_STANDARDS.md). Read those two rules first —
behavior through public interfaces, and mocking at system boundaries only.
Everything here is how they look in practice.

## Good tests

Integration-style tests that exercise real code paths through public APIs. They
describe _what_ the system does, not _how_.

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

## Bad tests

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

## Mocking at a boundary

Prefer SDK-style interfaces over generic fetchers at boundaries — each function
is independently mockable with a single return shape, no conditional logic in
test setup.

## Remotion renderer packages

**Never write an automated test against a Remotion renderer package's actual
render output** — not for the packages that exist today, not for any added
later. A real render boots Chromium, takes minutes, downloads a browser on a
cold machine, and asserts on pixels that a deliberate branding change is
supposed to move; the test then fails for the one reason that is not a bug.

What is still fair game, and where the confidence comes from instead:

- The renderer's **props schema** — pure schema validation, no Chromium. Test
  it; it is the contract every caller writes against.
- The **orchestration around the render** — the props a service builds, and the
  arguments it spawns the renderer with. Test that, with the renderer faked at
  the process boundary like any other external process.
- The **look** is checked by a human in Remotion Studio (`pnpm run studio`),
  not by a test.

## TDD workflow: vertical slices

Write one test, make it pass, then write the next. Writing every test first
produces tests that verify _imagined_ behavior and are insensitive to real
changes.

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
RED→GREEN: test3→impl3
```

Each test responds to what you learned from the previous cycle. Get to GREEN
before you refactor.
