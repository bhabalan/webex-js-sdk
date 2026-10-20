# SPARK-866626 fork proof

Verified on 20 October 2026. All three merge-triggered GitHub Actions runs passed.

[Upstream PR #5297](https://github.com/webex/webex-js-sdk/pull/5297) was tested at commit [56328c3b77646c20572c26d7725d3d168363bdcb](https://github.com/bhabalan/webex-js-sdk/commit/56328c3b77646c20572c26d7725d3d168363bdcb).
Each run checks that the CLI source, package-tools source, TypeScript configuration, and production deploy workflow match that commit.
Node 22.14.0 and the SDK's Yarn 3.4.1 were used. The tools were built from source in a clean full SDK checkout.

| Merge case | Fork PR | Actions result | Observed behavior |
| --- | --- | --- | --- |
| markdown | [#6](https://github.com/bhabalan/webex-js-sdk/pull/6) | [PASS](https://github.com/bhabalan/webex-js-sdk/actions/runs/39378857605) | Empty lists; no version change; no packages published |
| sdd | [#7](https://github.com/bhabalan/webex-js-sdk/pull/7) | [PASS](https://github.com/bhabalan/webex-js-sdk/actions/runs/39378959624) | Empty lists; no version change; no packages published |
| source | [#8](https://github.com/bhabalan/webex-js-sdk/pull/8) | [PASS](https://github.com/bhabalan/webex-js-sdk/actions/runs/39379021781) | Runtime and dependent selected; both incremented and published as 0.0.0-next.1 |

For Markdown and SDD, both Node outputs were empty strings and both Yarn outputs were `{}`.
The fixture manifests stayed at 0.0.0, and registry metadata requests for both packages returned 404.
For the source change, only the runtime appeared in the direct list; the recursive list also included its dependent.
Both versions became 0.0.0-next.1. Registry metadata confirmed both publications and their next tags.
The downloaded runtime tarball contained the changed source (`module.exports = 42;`).

The increment and deploy steps ran in all three cases with no guard for an empty package list:

```sh
yarn package-tools increment --packages $NODE_RECURSIVE --tag next
yarn workspaces foreach --from "$PROOF_YARN_SELECTION" --verbose run deploy:npm --access public --tag next
```

Thus the empty `--packages --tag next` invocation succeeded in GitHub Actions with the actual SDK tooling.
The empty Yarn selector `{}` also completed successfully. The claim that this empty increment invocation exits with a missing-value error did not reproduce.

Publishing used two fixture workspaces and a fresh Verdaccio registry bound to 127.0.0.1, with no uplinks.
Registry credentials were generated per run and masked. No production npm credentials or public npm releases were used.
This checks package selection, version increment, and fixture npm publication. The full SDK build, tag, documentation deployment, and notification jobs were outside this test.

Each Actions run has an artifact with evidence.json, increment/deploy logs, and the local registry log. The source run also includes the published tarballs.
Artifacts are retained for 30 days. Complete copies of the artifacts, run metadata, and Actions logs were also saved locally.

An earlier attempt stopped because a fork-harness variable named YARN_RECURSIVE conflicted with Yarn configuration. The harness was corrected in [1d4982b114](https://github.com/bhabalan/webex-js-sdk/commit/1d4982b11476e5a7a59adac0d849a1f187726b3a), and the successful tests above repeated the merges. This required no changes to the reviewed SDK tooling.
