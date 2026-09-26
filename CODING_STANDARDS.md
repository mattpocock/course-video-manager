# Coding standards

Rules the **review** agent enforces on a diff. Read this during review, not while implementing — the implementation agent has the context pressure, the reviewer has the diff.

A standard here is a judgement call, or a rule on its way to becoming a check. When a rule can be checked mechanically, it graduates into `.oxlintrc.json` as an **error** (see `no-restricted-globals` there for the shape) and this file keeps only what a linter cannot decide.

## Every `any` is a leak

An `any` switches the type checker off for every value that flows through it, and the values keep flowing long after the line that produced them. Treat each one as a leak to be plugged, and leave a file with fewer of them than you found.

**Write the type you actually mean:**

- A shape you know — name it. One `interface` at the top beats a cast at each of thirteen call sites.
- A shape you do not know yet — `unknown`, then narrow. This is the honest form of `any`: it makes the reader prove the shape before using it.
- A shape that varies by caller — a generic, **constrained** to the real thing. `<R extends LayerLive>` says what `<R>` does not.
- A symbol or brand a library owns — reach for the library's own exported id (`Runtime.FiberFailureCauseId`) before you reach for a cast.

**What a leak costs, from this repo.** `makeLoader` took `runtime: ManagedRuntime<any, any>` and left `R` unconstrained. A route asked for a service the runtime did not provide, `tsgo` stayed green across all 111 route modules, and the page returned a 500 on every load (#1737, fixed in #1738). The `any` did not cause the missing service; it removed the one thing that would have caught it.

**When an `any` survives review.** A third-party type that is genuinely `any` at the boundary, and nothing narrower type-checks. Contain it: cast once at the edge into a named type, and keep the `any` out of the signature everything else calls. An `any` in an exported signature leaks to every caller; an `any` in one line of a function body does not.

**Reviewing a diff:** a new `any` needs a reason in the PR. An `any` already in a file you are touching is an invitation, the same way an oxlint `correctness` warning is.
