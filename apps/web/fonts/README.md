# Vendored typefaces

Self-hosted so the instrument's identity does not depend on what happens to be
installed locally. Before this, `--font-silk` resolved to Futura on macOS, to
Trebuchet MS on a stock Windows box (15.5% narrower, humanist, single-storey
`g` — the opposite personality from geometric Futura), and `IBM Plex Mono`
resolved to Menlo essentially everywhere, so the face named as the data voice
of the instrument was loading on almost nobody.

Latin subsets only (`U+0000-00FF`), woff2.

| File | Family | Role | License |
|---|---|---|---|
| `jost-var.woff2` | Jost\* 300–700 variable | `--font-silk` — silkscreen caps, the panel voice | SIL OFL 1.1 |
| `plexmono-400.woff2` | IBM Plex Mono 400 | `--font-mono` — values, readouts, data | SIL OFL 1.1 |
| `plexmono-600.woff2` | IBM Plex Mono 600 | `--font-mono` emphasis | SIL OFL 1.1 |
| `newsreader-it.woff2` | Newsreader italic 300–600 variable | `--font-voice` — the model speaking | SIL OFL 1.1 |

Jost\* is Owen Earl's open geometric sans in the Futura lineage, which is why it
substitutes cleanly for the original stack's intent. All four are licensed under
the SIL Open Font License 1.1 and may be redistributed with this application;
see <https://openfontlicense.org>.
