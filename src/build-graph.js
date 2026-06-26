import { newStore, storeToTurtle } from "@foerderfunke/sem-ops-utils"
import { QueryEngine } from "@comunica/query-sparql-file"
import { DataFactory } from "rdf-data-factory"
import haversine from "haversine-distance"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

// the playgrounds file is reused as-is; toilets, cafes and fountains are fetched live

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLAYGROUNDS_TTL = path.join(THIS_DIR, "inputs", "240826-spielplaetze.ttl")
const PLAYGROUNDS_DISTRIBUTION_TTL = path.join(THIS_DIR, "inputs", "playgrounds-distribution.ttl")
const TOILETS_DISTRIBUTION_TTL = path.join(THIS_DIR, "inputs", "toilets-distribution.ttl")
const FOUNTAINS_DISTRIBUTION_TTL = path.join(THIS_DIR, "inputs", "trinkbrunnen-distribution.ttl")
// Two Landeshauptstadt München datasets fetched live as GeoJSON from the Geoportal WFS:
// "WC-Standorte" (open.bydata 80832bca-499b-4b24-bb41-9e77f0ef31ee) and "Stadtplan der
// städtischen Trinkbrunnen" (7e8484f0-12c2-40be-bd0c-cfe04f63a624). The WFS serves WGS84
// lat/long directly when we request srsName=EPSG:4326.
const TOILETS_GEOJSON_URL = "https://geoportal.muenchen.de/geoserver/gsm_wfs/ows"
    + "?service=WFS&version=1.0.0&request=GetFeature&typeName=gsm_wfs:wc_finder_opendata"
    + "&outputFormat=application/json&srsName=EPSG:4326"
const FOUNTAINS_GEOJSON_URL = "https://geoportal.muenchen.de/geoserver/baug_wfs/ows"
    + "?service=WFS&version=1.0.0&request=GetFeature&typeName=baug_wfs:trinkwasserbrunnen"
    + "&outputFormat=application/json&srsName=EPSG:4326"
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

// shared helpers for building triples directly from fetched GeoJSON
const rdfType = DF.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
const decimal = value => DF.literal(String(value), DF.namedNode(`${prefixes.xsd}decimal`))

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

// toilets (WC-Standorte) — fetched live from the GeoJSON distribution, like the fountains below

const toiletsRes = await fetch(TOILETS_GEOJSON_URL)
const toiletsGeoJson = await toiletsRes.json()
for (const feature of toiletsGeoJson.features) {
    if (!feature.geometry?.coordinates) continue
    const localId = String(feature.id).split(".").pop() // "wc_finder_opendata.1" -> "1"
    const [lon, lat] = feature.geometry.coordinates     // GeoJSON in EPSG:4326 is [lon, lat]
    const subject = DF.namedNode(`${prefixes.dev}wc_finder_opendata.${localId}`)
    store.addQuad(DF.quad(subject, rdfType, DF.namedNode(`${prefixes.dev}PublicToilet`)))
    store.addQuad(DF.quad(subject, DF.namedNode(`${prefixes.geo}lat`), decimal(lat)))
    store.addQuad(DF.quad(subject, DF.namedNode(`${prefixes.geo}long`), decimal(lon)))
}
// stamp dct:modified onto the toilets from the distribution metadata snapshot
query = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    INSERT {
        ?toilet dct:modified ?modifiedDate .
    } WHERE {
        ?toilet a dev:PublicToilet .
        ?dist a dcat:Distribution ;
            dct:modified ?modified .
        BIND(xsd:date(?modified) AS ?modifiedDate)
    }`
await engine.queryVoid(query, {
    sources: [store, { type: "file", value: TOILETS_DISTRIBUTION_TTL }],
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

// drinking fountains (Trinkbrunnen)

const fountainsRes = await fetch(FOUNTAINS_GEOJSON_URL)
const fountainsGeoJson = await fountainsRes.json()
for (const feature of fountainsGeoJson.features) {
    const localId = String(feature.id).split(".").pop() // "trinkwasserbrunnen.1" -> "1"
    const [lon, lat] = feature.geometry.coordinates     // GeoJSON in EPSG:4326 is [lon, lat]
    const subject = DF.namedNode(`${prefixes.dev}trinkbrunnen.${localId}`)
    store.addQuad(DF.quad(subject, rdfType, DF.namedNode(`${prefixes.dev}DrinkingFountain`)))
    store.addQuad(DF.quad(subject, DF.namedNode(`${prefixes.geo}lat`), decimal(lat)))
    store.addQuad(DF.quad(subject, DF.namedNode(`${prefixes.geo}long`), decimal(lon)))
    const name = feature.properties?.bezeichnung
    if (name) store.addQuad(DF.quad(subject, DF.namedNode(`${prefixes.schema}name`), DF.literal(name)))
}
// stamp dct:modified onto the fountains from the distribution metadata snapshot (like toilets/playgrounds)
query = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    INSERT {
        ?fountain dct:modified ?modifiedDate .
    } WHERE {
        ?fountain a dev:DrinkingFountain .
        ?dist a dcat:Distribution ;
            dct:modified ?modified .
        BIND(xsd:date(?modified) AS ?modifiedDate)
    }`
await engine.queryVoid(query, {
    sources: [store, { type: "file", value: FOUNTAINS_DISTRIBUTION_TTL }],
    destination: store
})
console.log("Done inserting playgrounds, toilets, cafes and drinking fountains")

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

query = `
    PREFIX dev: <https://open.bydata.de/api/hub/dev#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
    INSERT {
        ?playground dev:hasNearbyDrinkingFountain ?fountain .
    } WHERE {
        ?playground a dev:Playground ;
            dev:playgroundTargetGroup ?ptargetgroup ;
            geo:lat ?plat ;
            geo:long ?plon .
        FILTER regex(?ptargetgroup, "kleinkinder", "i")

        ?fountain a dev:DrinkingFountain ;
            geo:lat ?flat ;
            geo:long ?flon .

        BIND(dev:calcDistance(?plat, ?plon, ?flat, ?flon) AS ?distPtoF)
        FILTER(?distPtoF < ${MAX_DIST})
    }`
// only 116 fountains, so this is fast
await engine.queryVoid(query, {
    sources: [store],
    extensionFunctions: { "https://open.bydata.de/api/hub/dev#calcDistance": calcDistanceExtension }
})
console.log("Query for nearby drinking fountains done")

let turtle = await storeToTurtle(store, prefixes)
fs.writeFileSync(OUTPUT_TTL, turtle, "utf8")
console.log(`Wrote ${OUTPUT_TTL}`)
