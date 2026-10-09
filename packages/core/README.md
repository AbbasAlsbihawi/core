# @abbasalsbihawi/core

Runtime building blocks of the templates. ESM with types; one entry point per module so a browser bundle never pulls server code.

| Import                                | Exports                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@abbasalsbihawi/core/csp`            | `makeNonce`, `nonceCsp(nonce, { dev, reportPath, extend })`, `staticCsp({ hashes, dev, reportPath, extend })`, `CSP_REPORT_PATH` |
| `@abbasalsbihawi/core/csp-report`     | `parseCspReport(body)`, `MAX_REPORTS`, `CspViolation`                                                                            |
| `@abbasalsbihawi/core/read-body`      | `readBodyCapped(request, maxBytes)`                                                                                              |
| `@abbasalsbihawi/core/origin`         | `isSameOrigin(request, appOrigin)`                                                                                               |
| `@abbasalsbihawi/core/document-nonce` | `documentNonce()`                                                                                                                |
| `@abbasalsbihawi/core/i18n`           | `getDirection`, `toLocale(value, routing)`, `pickMessages`, `formats`, `localeAlternates`                                        |
| `@abbasalsbihawi/core/brand`          | `brandVars`, `brandCss`, `maxChromaSrgb`, `seedToHex`, `hexToOklch`, `isBrightHue`, `BRAND_STEPS`                                |

`zod` (^4) is an optional peer, used by `csp-report` only.
