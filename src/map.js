import { QueryEngine } from "@comunica/query-sparql-file"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const INPUT_TTL = path.join(THIS_DIR, "triples.ttl")
const HTML_TEMPLATE = path.join(THIS_DIR, "map.html.template")
const OUTPUT_HTML = path.join(THIS_DIR, "map.html")
const engine = new QueryEngine()

// zoomable map output

let query = `
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>

    SELECT ?plat ?plon ?tlat ?tlon ?clat ?clon WHERE {
        ?playground a dev:Playground ;
            geo:lat ?plat ;
            geo:long ?plon ;
            dev:hasNearbyToilet ?toilet ;
            dev:hasNearbyCafe ?cafe .
        # BIND(CONCAT(STR(?plat), " ", STR(?plon)) AS ?pCoords)

        ?toilet geo:lat ?tlat ;
            geo:long ?tlon .

        ?cafe geo:lat ?clat ;
            geo:long ?clon .
    }`
let bindingsStream = await engine.queryBindings(query,
    { sources: [{ type: "file", value: INPUT_TTL }] }
)
let rows = await bindingsStream.toArray()

let points = []
const pCol = "#ffff00"
const tCol = "#ff0000"
const cCol = "#0000ff"
for (const row of rows) {
    points.push({ lat: row.get("plat").value, lon: row.get("plon").value, color: pCol })
    points.push({ lat: row.get("tlat").value, lon: row.get("tlon").value, color: tCol })
    points.push({ lat: row.get("clat").value, lon: row.get("clon").value, color: cCol })
}

let html = fs.readFileSync(HTML_TEMPLATE, "utf8")
html = html.replace("{{POINTS}}", JSON.stringify(points))
fs.writeFileSync(OUTPUT_HTML, html, "utf8")
console.log(`Wrote ${OUTPUT_HTML}`)
