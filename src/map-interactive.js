import { QueryEngine } from "@comunica/query-sparql-file"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

// Generates the *interactive* map (separate from map.js / map.html so the static map stays untouched).
// Unlike the static map, this does NOT use the precomputed dev:hasNearby* edges: it ships the raw points
// (kleinkinder-playgrounds + all toilets/cafes/fountains) to the browser, which computes proximity itself
// so the distance threshold and the per-amenity Erforderlich/Optional/Ausgeblendet modes can be changed live.

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const INPUT_TTL = path.join(THIS_DIR, "triples.ttl")
const HTML_TEMPLATE = path.join(THIS_DIR, "map-interactive.html.template")
const OUTPUT_HTML = path.join(THIS_DIR, "map-interactive.html")
const engine = new QueryEngine()

const PREFIXES = `
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX schema: <http://schema.org/>`

const select = async query => {
    const stream = await engine.queryBindings(query, { sources: [{ type: "file", value: INPUT_TTL }] })
    const rows = await stream.toArray()
    return rows.map(r => ({ lat: +r.get("lat").value, lon: +r.get("lon").value, name: r.get("name").value }))
}

// kleinkinder-playgrounds only (the use-case scope); fall back to the local id if a playground has no title
const playgrounds = await select(`${PREFIXES}
    SELECT ?lat ?lon (COALESCE(?title, REPLACE(STR(?s), "^.*[#/]", "")) AS ?name) WHERE {
        ?s a dev:Playground ;
            dev:playgroundTargetGroup ?g ;
            geo:lat ?lat ;
            geo:long ?lon .
        OPTIONAL { ?s dct:title ?title }
        FILTER regex(?g, "kleinkinder", "i")
    }`)

// toilets carry no name -> label them with their local id (e.g. wc_finder_opendata.34)
const toilets = await select(`${PREFIXES}
    SELECT ?lat ?lon (REPLACE(STR(?s), "^.*[#/]", "") AS ?name) WHERE {
        ?s a dev:PublicToilet ; geo:lat ?lat ; geo:long ?lon .
    }`)

const cafes = await select(`${PREFIXES}
    SELECT ?lat ?lon (COALESCE(?nm, "") AS ?name) WHERE {
        ?s a dev:Cafe ; geo:lat ?lat ; geo:long ?lon . OPTIONAL { ?s schema:name ?nm }
    }`)

const fountains = await select(`${PREFIXES}
    SELECT ?lat ?lon (COALESCE(?nm, "") AS ?name) WHERE {
        ?s a dev:DrinkingFountain ; geo:lat ?lat ; geo:long ?lon . OPTIONAL { ?s schema:name ?nm }
    }`)

let html = fs.readFileSync(HTML_TEMPLATE, "utf8")
html = html
    .replace("{{PLAYGROUNDS}}", JSON.stringify(playgrounds))
    .replace("{{TOILETS}}", JSON.stringify(toilets))
    .replace("{{CAFES}}", JSON.stringify(cafes))
    .replace("{{FOUNTAINS}}", JSON.stringify(fountains))
fs.writeFileSync(OUTPUT_HTML, html, "utf8")
console.log(`Wrote ${OUTPUT_HTML} (${playgrounds.length} playgrounds, ${toilets.length} toilets, ${cafes.length} cafes, ${fountains.length} fountains)`)
