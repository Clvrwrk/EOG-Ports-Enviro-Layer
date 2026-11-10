# Port site maps

`hueneme-site.json` holds the structures, roads, rail and piers the Port of
Hueneme twin draws as its site layers.

It is derived from [OpenStreetMap](https://www.openstreetmap.org/copyright)
data, © OpenStreetMap contributors, and is available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
not the repository's MIT source-code license.

Changes from the source: features outside the port area were dropped, only
the outline and a few tags of each feature were kept, coordinates were
rounded to six decimal places, and a height was assumed for every structure
(OpenStreetMap has none here). Rebuild it with
`node scripts/build-port-site.mjs <overpass.json> public/data/port/hueneme-site.json`.
