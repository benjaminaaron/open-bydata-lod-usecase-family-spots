# LOD Use Case Family Spots – Familienfreundliches München: Spielplätze mit nahegelegenen Toiletten und Cafés

## Ausgangsfrage

Spielplätze in München finden, die mindestens eine öffentliche Toilette und mindestens ein Café in einem 200 m-Radius haben und damit die Bedürfnisse von Familien besonders gut abdecken.

## Datensätze & Lizenzen

- Der Datensatz [Öffentliche Spielplätze](https://open.bydata.de/datasets/0760ce3a-fef8-43e4-888f-8cc92fdf56de) der Landeshauptstadt München (LHM)
  - Die [DCAT-AP.de-Metadaten](https://open.bydata.de/api/hub/repo/distributions/b7754bf1-c799-47bf-8f1a-8cfad0abe9ee.ttl) der CSV-Distribution davon
    - Hier fand die CSV-zu-RDF-Konvertierung bereits im Rahmen eines Experimente-Skripts via CSVW statt und wurde wiederverwendet
  - [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
- Der Datensatz [WC-Standorte](https://open.bydata.de/datasets/80832bca-499b-4b24-bb41-9e77f0ef31ee) der LHM
  - Hier fand die CSV-zu-RDF-Konvertierung ebenfalls bereits im Rahmen eines Skripts via CSVW (+ Postprocessing der Koordinaten) statt und wurde wiederverwendet
  - [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
- Cafés in München von [OpenStreetMap](https://www.openstreetmap.org/#map=19/48.104326/11.597373) via dem [QLever SPARQL-Endpunkt](https://qlever.dev/osm-planet/?query=PREFIX+ogc%3A+%3Chttp%3A%2F%2Fwww.opengis.net%2Frdf%23%3E%0APREFIX+geo%3A+%3Chttp%3A%2F%2Fwww.opengis.net%2Font%2Fgeosparql%23%3E%0APREFIX+geof%3A+%3Chttp%3A%2F%2Fwww.opengis.net%2Fdef%2Ffunction%2Fgeosparql%2F%3E%0APREFIX+geo84%3A+%3Chttp%3A%2F%2Fwww.w3.org%2F2003%2F01%2Fgeo%2Fwgs84_pos%23%3E%0APREFIX+osmkey%3A+%3Chttps%3A%2F%2Fwww.openstreetmap.org%2Fwiki%2FKey%3A%3E%0APREFIX+osmrel%3A+%3Chttps%3A%2F%2Fwww.openstreetmap.org%2Frelation%2F%3E%0APREFIX+schema%3A+%3Chttp%3A%2F%2Fschema.org%2F%3E%0ACONSTRUCT+%7B%0A++%3Fcafe+schema%3Aname+%3Fname+%3B%0A++++++++geo84%3Alat+%3Flat+%3B%0A++++++++geo84%3Alon+%3Flon+.%0A%7D%0AWHERE+%7B%0A++osmrel%3A62428+ogc%3AsfContains+%3Fcafe+.%0A++%3Fcafe+osmkey%3Aamenity+%22cafe%22+%3B%0A++++++++geo%3AhasGeometry%2Fgeo%3AasWKT+%3Fwkt+.%0A++OPTIONAL+%7B+%3Fcafe+osmkey%3Aname+%3Fname+%7D%0A++BIND%28geof%3Acentroid%28%3Fwkt%29+AS+%3Fpt%29%0A++BIND%28geof%3Alatitude%28%3Fpt%29++AS+%3Flat%29%0A++BIND%28geof%3Alongitude%28%3Fpt%29+AS+%3Flon%29%0A%7D)
  - [Open Data Commons Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/)

## Vorgehensweise

[Transformation zu RDF und Verschmelzung](src/build-graph.js) zu einem [Wissensgraphen](src/triples.ttl). Dazu wurde ein in-memory Triple Store schrittweise angereichert mit den drei „RDFizierten“ Datensätzen (Spielplätze + Metadaten und WCs) und dann wurden die Result-Triples von OSM direkt per SPARQL UPDATE überführt. Comunica, das JavaScript-Framework, das hier für die Queries benutzt wurde, hat im Gegensatz zu Virtuoso keine nativen Geo-Funktionen eingebaut. Daher wurde eine Funktion zur Distanzberechnung per `extensionFunctions` direkt zur QueryEngine hinzugefügt, um sie dann aus der SPARQL-Query heraus nutzen zu können.

Um Trios von Spielplätzen mit nahgelegenen Toiletten und Cafés zu finden, müssen in diesem Fall zwei Distanzen berechnet werden: Spielplatz zu Toilette und Spielplatz zu Café. Um die hierfür erforderliche Rechnenleistung zu minimieren, wurden die Distanzberechnungen auf zwei Queries aufgeteilt und die jeweiligen Treffer (Distanzen unter 200 m) an den Triples der Spielplätze „Hinweise“ angehängt: `dev:hasNearbyToilet` und `dev:hasNearbyCafe`.

Hier ein Snapshot der daraus resultierenden Triples:

```turtle
dev:playground-10234704 a dev:Playground;
  dct:modified "2024-08-29"^^xsd:date;
  dct:title "Spielplatz \"Herkomerplatz\"";
  geo:lat 48.15069803269996; geo:long 11.610006093975898;
  dev:playgroundTargetGroup "Schulkinder\r\nKleinkinder";
  dev:hasNearbyCafe osm:1371830504;
  dev:hasNearbyToilet dev:wc_finder_opendata.34.

osm:1371830504 a dev:Cafe;
  schema:name "Bistro+Cafe ÖQ";
  geo:lat 48.15120110116; geo:long 11.60964953863.

dev:wc_finder_opendata.34 a dev:PublicToilet;
  geo:lat 48.15107232457436; geo:long 11.607848569920932.
```

Nun können die angereicherten Hinweise genutzt werden, um die Trios einzusammeln ([SPARQL-Query](src/playgrounds-fulfilling-criteria.sparql)). Das Ergebnis sind 24 Spielplätze in München, die die gewünschten Kriterien erfüllen:

| playground | lastUpdated | toilets | cafes |
| --- | --- | --- | --- |
| Spielplatz "Herkomerplatz" | 2024-08-29 | wc_finder_opendata.34 | Bistro+Cafe ÖQ |
| Spielplatz "Hochäckerstraße" | 2024-08-29 | wc_finder_opendata.284 | Jugendcafé |
| … | … | … | … |

Alle gefundenen Orte können in einer [interaktiven Karte](src/map.html) eingesehen werden (erzeugt mit [map.js](src/map.js)) bzw. über den Screenshot unten. Zur Erklärung: Spielplätze sind gelb, Toiletten rot und Cafés blau. Manche Spots haben mehrere Toiletten und Cafés, die weniger als 200 m von „ihrem“ Spielplatz entfernt sind:

![Familienfreundliche Spielplätze in München](img/screenshot.jpg)

Weitere Informationen über die Entstehungsgeschichte und den Kontext zu diesem Anwendungsfall findet man in [diesem Repo](https://github.com/bydata/open-bydata-lod-usecases).

## Code ausführen

**Um die Ergebnisse zu sehen, muss nichts ausgeführt werden.** Die interaktive Karte (einfach [`src/map.html`](src/map.html) im Browser öffnen), der fertige Wissensgraph [`src/triples.ttl`](src/triples.ttl) und der Screenshot (siehe oben) liegen bereits im Repo.

**Queries selbst ausführen** (verändert nichts am Repo): Den Wissensgraphen [`src/triples.ttl`](src/triples.ttl) in eine Graph-Datenbank importieren und die Analyse-Query [`playgrounds-fulfilling-criteria.sparql`](src/playgrounds-fulfilling-criteria.sparql) im SPARQL-Editor der Graph-Datenbank ausführen.

**Graph und Karte neu erzeugen** (überschreibt die mitgelieferten Dateien):

```bash
npm install
node src/build-graph.js   # baut src/triples.ttl aus den Eingabedaten in src/inputs/ + Cafés live via OpenStreetMap
node src/map.js           # erzeugt src/map.html aus src/triples.ttl neu
```

`build-graph.js` liest die vorbereiteten Spielplatz- und WC-Daten samt zugehöriger DCAT-Metadaten aus [`src/inputs/`](src/inputs) und reichert sie um Cafés an, die live über den QLever-OSM-Endpunkt abgefragt werden. Die RDF-Konvertierung dieser Daten fand bereits in einer früheren Projektphase statt, bevor dieses Repo für den Anwendungsfall eingerichtet wurde. Die DCAT-Metadaten liegen als lokale Snapshots in `src/inputs/`, da die zugehörigen open.bydata-Distributions-URLs nicht stabil sind (eine davon ist inzwischen nicht mehr abrufbar). Die Café-Daten spiegeln den aktuellen OSM-Stand wider und können daher leicht vom mitgelieferten Snapshot abweichen.

## Autoren
Dieser Code wurde von [Benjamin Degenhart](https://github.com/benjaminaaron) in Zusammenarbeit mit oc.bydata erstellt.
