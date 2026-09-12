# Third-Party Notices

## Hydra

This application includes a WebAssembly build of the Hydra urban-drainage
engine:

- Project: <https://github.com/neeraip/hydra>
- Release: `v12.1.0`
- Source commit: `2a75372531b981c3a8f6668cbb846a0366cf062d`
- License: GNU Affero General Public License v3.0 (AGPL-3.0)
- Bundled license: `client/public/wasmhydra/LICENSE-AGPL-3.0.txt`
- Build and adapter provenance: `client/public/wasmhydra/README.md`

The browser adapter source is retained in this repository. Hydra is a separate
implementation that imports SWMM models; inclusion does not imply numerical
equivalence with EPA SWMM or OpenSWMM.

AGPL-3.0 can impose source-availability obligations when software is modified,
distributed, or used over a network. Anyone publishing this application is
responsible for making the complete corresponding source available to users
and preserving applicable copyright and license notices. This notice records
provenance and is not legal advice.