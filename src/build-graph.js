import { newStore, storeToTurtle } from "@foerderfunke/sem-ops-utils"
import { QueryEngine } from "@comunica/query-sparql-file"
import { DataFactory } from "rdf-data-factory"
import haversine from "haversine-distance"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

// we reuse the already downloaded and processed playgrounds and toilet files

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLAYGROUNDS_TTL = path.join(THIS_DIR, "inputs", "240826-spielplaetze.ttl")
const PLAYGROUNDS_DISTRIBUTION_TTL = path.join(THIS_DIR, "inputs", "playgrounds-distribution.ttl")
const TOILETS_TTL = path.join(THIS_DIR, "inputs", "wc_finder_opendata_postprocessed.ttl")
const TOILETS_DISTRIBUTION_TTL = path.join(THIS_DIR, "inputs", "toilets-distribution.ttl")
const OSM_ENDPOINT = "https://qlever.dev/api/osm-planet"
const OUTPUT_TTL = path.join(THIS_DIR, "triples.ttl")
export const prefixes = {
    "dev": "https://open.bydata.de/api/hub/dev#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "schema": "http://schema.org/",
    "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#",
    "dct": "http://purl.org/dc/terms/",
    "osm": "https://www.openstreetmap.org/node/",
    "dcat": "http://www.w3.org/ns/dcat#"
}
const engine = new QueryEngine()
const DF = new DataFactory()
const store = newStore()

// playgrounds

let query = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    INSERT {
        ?playground dct:modified ?modifiedDate ;
            ?p ?o .
    } WHERE {
        ?playground a dev:Playground ;
            ?p ?o .
        ?dist a dcat:Distribution ;
            dct:modified ?modified .
        BIND(xsd:date(?modified) AS ?modifiedDate)
    }`
await engine.queryVoid(query, {
    sources: [
        { type: "file", value: PLAYGROUNDS_TTL },
        { type: "file", value: PLAYGROUNDS_DISTRIBUTION_TTL }
    ],
    destination: store
})

// toilets

query = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    INSERT {
        ?toilet dct:modified ?modifiedDate ;
            ?p ?o .
    } WHERE {
        ?toilet a dev:PublicToilet ;
            ?p ?o .
        ?dist a dcat:Distribution ;
            dct:modified ?modified .
        BIND(xsd:date(?modified) AS ?modifiedDate)
    }`
await engine.queryVoid(query, {
    sources: [
        { type: "file", value: TOILETS_TTL },
        { type: "file", value: TOILETS_DISTRIBUTION_TTL }
    ],
    destination: store
})

// cafes

query = `
    PREFIX ogc: <http://www.opengis.net/rdf#>
    PREFIX geo: <http://www.opengis.net/ont/geosparql#>
    PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
    PREFIX geo84: <http://www.w3.org/2003/01/geo/wgs84_pos#>
    PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
    PREFIX osmrel: <https://www.openstreetmap.org/relation/>
    PREFIX schema: <http://schema.org/>
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    CONSTRUCT {
        ?cafe a dev:Cafe ;
            schema:name ?name ;
            geo84:lat ?lat ;
            geo84:long ?lon .
    }
    WHERE {
        osmrel:62428 ogc:sfContains ?cafe .
        ?cafe osmkey:amenity "cafe" ;
            geo:hasGeometry/geo:asWKT ?wkt .
        OPTIONAL { ?cafe osmkey:name ?name }
        BIND(geof:centroid(?wkt) AS ?pt)
        BIND(geof:latitude(?pt)  AS ?lat)
        BIND(geof:longitude(?pt) AS ?lon)
    }`
const quadStream = await engine.queryQuads(query, { sources: [{ type: "sparql", value: OSM_ENDPOINT }] })
for await (const q of quadStream) store.addQuad(q)
console.log("Done inserting playgrounds, toilets and cafes")

// calculate dev:hasNearbyToilet and dev:hasNearbyCafe

const MAX_DIST = 200 // meters

const calcDistanceExtension = (args) => {
    const lat1 = Number(args?.[0]?.value)
    const lon1 = Number(args?.[1]?.value)
    const lat2 = Number(args?.[2]?.value)
    const lon2 = Number(args?.[3]?.value)
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
        return DF.literal("NaN", DF.namedNode("http://www.w3.org/2001/XMLSchema#double"))
    }
    const dist = haversine({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 })
    return DF.literal(String(Math.round(dist)), DF.namedNode("http://www.w3.org/2001/XMLSchema#integer"))
}

query = `
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>   
    INSERT {
        ?playground dev:hasNearbyToilet ?toilet .
    } WHERE {
        ?playground a dev:Playground ;
            dev:playgroundTargetGroup ?ptargetgroup ;
            geo:lat ?plat ;
            geo:long ?plon .
        FILTER regex(?ptargetgroup, "kleinkinder", "i")
            
        ?toilet a dev:PublicToilet ;
            geo:lat ?tlat ;
            geo:long ?tlon .

        BIND(dev:calcDistance(?plat, ?plon, ?tlat, ?tlon) AS ?distPtoT) # in meters
        FILTER(?distPtoT < ${MAX_DIST})
    }`
// needs ~1min10sec on a MacBook Air M4
console.log("Computing nearby toilets and cafes — the two distance queries take a few minutes...")
await engine.queryVoid(query, {
    sources: [store],
    extensionFunctions: { "https://open.bydata.de/api/hub/dev#calcDistance": calcDistanceExtension }
})
console.log("Query for nearby toilets done")

query = `
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>   
    INSERT {
        ?playground dev:hasNearbyCafe ?cafe .
    } WHERE {
        ?playground a dev:Playground ;
            dev:playgroundTargetGroup ?ptargetgroup ;
            geo:lat ?plat ;
            geo:long ?plon .
        FILTER regex(?ptargetgroup, "kleinkinder", "i")
            
        ?cafe a dev:Cafe ;
            geo:lat ?clat ;
            geo:long ?clon .

        BIND(dev:calcDistance(?plat, ?plon, ?clat, ?clon) AS ?distPtoC)
        FILTER(?distPtoC < ${MAX_DIST})
    }`
// needs ~2min20sec
await engine.queryVoid(query, {
    sources: [store],
    extensionFunctions: { "https://open.bydata.de/api/hub/dev#calcDistance": calcDistanceExtension }
})
console.log("Query for nearby cafes done")

let turtle = await storeToTurtle(store, prefixes)
fs.writeFileSync(OUTPUT_TTL, turtle, "utf8")
console.log(`Wrote ${OUTPUT_TTL}`)
