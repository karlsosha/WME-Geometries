// ==UserScript==
// @name                WME Geometries
// @version             2025.03.09.001
// @description         Import geometry files into Waze Map Editor. Supports GeoJSON, GML, WKT, KML and GPX.
// @match               https://www.waze.com/*/editor*
// @match               https://www.waze.com/editor*
// @match               https://beta.waze.com/*
// @exclude             https://www.waze.com/*user/*editor/*
// @require             https://cdn.jsdelivr.net/npm/@tmcw/togeojson@7.0.0/dist/togeojson.umd.min.js
// @require             https://unpkg.com/@terraformer/wkt
// @require             https://cdn.jsdelivr.net/npm/gml2geojson@0.0.7/dist/gml2geojson.min.js
// @require             https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @require             https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @require             https://cdn.jsdelivr.net/npm/@placemarkio/geojson-rewind@1.0.2/dist/rewind.umd.min.js
// @grant               none
// @author              Timbones
// @contributor         wlodek76
// @contributor         Twister-UK
// @contributor         Karlsosha
// @namespace           https://greasyfork.org/users/3339
// @run-at              document-idle
// ==/UserScript==

/* global WazeWrap */

"use strict";

import { WmeSDK } from "wme-sdk-typings";
import * as toGeoJSON from "@tmcw/togeojson";
import * as Terraformer from "@terraformer/wkt";
import * as turf from "@turf/turf";
import { Feature, LineString, Point, Polygon, Position } from "geojson";
import WazeWrap from "https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js";
import * as rewind from "@placemarkio/geojson-rewind";

window.SDK_INITIALIZED.then(geometries);

function geometries() {
    const GF_LINK = "https://greasyfork.org/en/scripts/8129-wme-geometries";
    const FORUM_LINK = "https://www.waze.com/discuss/t/script-wme-geometries-v1-7-june-2021/291428/8";
    const GEOMETRIES_UPDATE_NOTES = `<b>NEW:</b><br>
    - Converted to WME SDK<br>
    - Added ability to remove individual layers<br>
    - Fixed issues with "butterfly" polygons<br>
    - Added ability to select field to display as label for the added shape.<br>
    - Support for 3D points and coordinates<br>
    - Multiple Bug Fixes. <br><br>
<b>KNOWN ISSUES:</b><br>
    - Label Property is a radio Button vs ability to select multiple properties.<br>
    - Draw State Boundary is no longer available<br><br>
    - 3D Points are not Supported. (LAT, LON, ALT)<br><br>
`;

    type MapFormatTypes = "GEOJSON" | "KML" | "WKT" | "GML" | "GMX" | "GPX";
    // show labels using first attribute that starts or ends with 'name' (case insensitive regexp)
    var defaultLabelName = /^name|name$/;

    // each loaded file will be rendered with one of these colours in ascending order
    var colorList: Set<string> = new Set(["deepskyblue", "magenta", "limegreen", "orange", "teal", "navy", "maroon"]);
    let usedColors: Set<string> = new Set();

    // Id of div element for Checkboxes:
    const checkboxListID = "geometries-cb-list-id";

    // -------------------------------------------------------------
    let geometryLayers: Set<string> = new Set();

    interface Parser {
        read: (content: string) => void;
        internalProjection: string;
        externalProjection: string;
    }

    let parser: Parser;

    enum Formats {
        GEOJSON = 0,
        KML = 1,
        WKT = 2,
        GML = 3,
        GMX = 4,
    }

    let formathelp: string = "GeoJSON, KML, WKT, GPX, GML";

    var layerindex: number = 0;
    let selectedAttrib: string = "";

    if (!window.getWmeSdk) {
        throw new Error("SDK is not installed");
    }
    const sdk: WmeSDK = window.getWmeSdk({
        scriptId: "wme-geometries",
        scriptName: "WME Geometries",
    });

    console.log(`SDK v ${sdk.getSDKVersion()} on ${sdk.getWMEVersion()} initialized`);

    // delayed initialisation
    sdk.Events.once({ eventName: "wme-map-data-loaded" }).then(() => {
        init();
    });

    // function processMapUpdateEvent() {
    //     if (Object.keys(geometryLayers).length === 0) return;
    //     for (const l in geometryLayers) {
    //         sdk.Map.removeLayer({ layerName: l });
    //         sdk.LayerSwitcher.removeLayerCheckbox({ name: l });
    //     }
    //     geometryLayers = {};
    //     loadLayers();
    // }
    // sdk.Events.on({ eventName: "wme-map-move-end", eventHandler: processMapUpdateEvent });
    // sdk.Events.on({ eventName: "wme-map-zoom-changed", eventHandler: processMapUpdateEvent });
    sdk.Events.on({
        eventName: "wme-layer-checkbox-toggled",
        eventHandler(payload) {
            sdk.Map.setLayerVisibility({ layerName: payload.name, visibility: payload.checked });
        },
    });

    class LayerStoreObj {
        fileContent: string | null | undefined;
        color: string;
        fileExt: string;
        fileName: string;
        formatType: MapFormatTypes;

        constructor(fileContent: string | null | undefined, color: string, fileext: string, filename: string) {
            this.fileContent = fileContent;
            this.color = color;
            this.fileExt = fileext;
            this.fileName = filename;
            this.formatType = <MapFormatTypes>fileext.toUpperCase();
        }
    }

    var geolist: HTMLUListElement;

    function loadLayers() {
        // Parse any locally stored layer objects
        let files: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
        for (const f in files) processGeometryFile(files[f]);
    }

    // add interface to Settings tab
    function init() {
        if (!WazeWrap.Ready) {
            setTimeout(() => {
                init();
            }, 100);
            return;
        }

        var geobox: HTMLDivElement = document.createElement<"div">("div");
        geobox.style.paddingTop = "6px";

        console.group();
        let sidepanelAreas = $("#sidepanel-areas");
        sidepanelAreas.append(geobox);

        var geotitle = document.createElement("h4");
        geotitle.innerHTML = "Import Geometry File";
        geobox.appendChild(geotitle);

        geolist = document.createElement<"ul">("ul");
        geobox.appendChild(geolist);

        var geoform: HTMLFormElement = document.createElement<"form">("form");
        geobox.appendChild(geoform);

        var inputfile: HTMLInputElement = document.createElement<"input">("input");
        inputfile.type = "file";
        inputfile.id = "GeometryFile";
        inputfile.title = ".geojson, .gml or .wkt";
        inputfile.addEventListener("change", addGeometryLayer, false);
        geoform.appendChild(inputfile);

        var notes = document.createElement("p");
        notes.style.marginTop = "12px";
        notes.innerHTML =
            `<b>Formats:</b> <span id="formathelp">${formathelp}</span><br> ` +
            "<b>Coords:</b> EPSG:4326, EPSG:4269, EPSG:3857";
        geoform.appendChild(notes);

        // var inputstate = document.createElement("input");
        // inputstate.type = "button";
        // inputstate.value = "Draw State Boundary";
        // inputstate.title = "Draw the boundary for the topmost state";
        // inputstate.onclick = drawStateBoundary;
        // geoform.appendChild(inputstate);

        var inputclear = document.createElement("input");
        inputclear.type = "button";
        inputclear.value = "Clear All";
        inputclear.style.marginLeft = "8px";
        inputclear.onclick = removeGeometryLayers;
        geoform.appendChild(inputclear);

        loadLayers();

        WazeWrap.Interface.ShowScriptUpdate(
            GM_info.script.name,
            GM_info.script.version,
            GEOMETRIES_UPDATE_NOTES,
            GF_LINK,
            FORUM_LINK
        );

        console.log("WME Geometries is now available....");

        console.groupEnd();
    }

    function addFormat(format: string) {
        $("#formathelp")[0].innerText += ", " + format;
    }

    // function drawStateBoundary() {
    //     let topState: State | null = sdk.DataModel.States.getTopState();
    //     if (!topState) {
    //         console.info("WME Geometries: no state or geometry available, sorry");
    //         return;
    //     }

    //     var layerName = `(${topState.name})`;
    //     var layers = W.map.getLayersBy("layerGroup", "wme_geometry");
    //     for (var i = 0; i < layers.length; i++) {
    //         if (layers[i].name === "Geometry: " + layerName) {
    //             console.info("WME Geometries: current state already loaded");
    //             return;
    //         }
    //     }

    //     var geo = formats.GEOJSON.parseGeometry(topState.name);
    //     var json = formats.GEOJSON.write(geo);
    //     var obj = new layerStoreObj(json, "grey", "GEOJSON", layerName);
    //     parseFile(obj);
    // }

    // import selected file as a vector layer
    function addGeometryLayer() {
        // get the selected file from user
        var fileListElement: HTMLInputElement = document.getElementById("GeometryFile") as HTMLInputElement;
        var fileList: FileList | null = fileListElement.files;
        if (!fileList) return;
        var file = fileList[0];
        fileListElement.value = "";

        processGeometryFile(file);
    }

    function processGeometryFile(file: File) {
        if (colorList.size === 0) {
            console.error("Cannot add Any more Layers at this point");
        }
        var fileext: string | undefined = file?.name?.split(".").pop();
        var filename: string | undefined = file?.name?.replace("." + fileext, "");
        if (!file || !file?.name || !fileext || !filename) return;
        fileext = fileext ? fileext.toUpperCase() : "";

        // add list item
        var color: string | undefined = colorList.values().next().value;
        if (!color) {
            console.error("Cannot add Any more Layers at this point");
            return;
        }
        colorList.delete(color);
        usedColors.add(color);
        var fileitem = document.createElement("li");
        fileitem.id = file.name.toLowerCase();
        fileitem.style.color = color;
        fileitem.innerHTML = "Loading...";
        geolist.appendChild(fileitem);

        // check if format is supported
        let parser = {
            read: null,
            internalProjection: null,
            externalProjection: null,
        };
        if (!parser) {
            fileitem.innerHTML = fileext.toUpperCase() + " format not supported :(";
            fileitem.style.color = "red";
            return;
        }

        // read the file into the new layer, and update the localStorage layer cache
        var reader = new FileReader();
        reader.onload = (function (theFile: File) {
            return function (ev: ProgressEvent<FileReader>) {
                if (!color) {
                    let msg = "Color is Undefined.  Cannot Load File";
                    console.error(msg);
                    throw new Error(msg);
                }
                var tObj = new LayerStoreObj(ev.target?.result, color, fileext, filename);
                parseFile(tObj);
                let filenames: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
                filenames[color] = theFile;
                localStorage.setItem("WMEGeoLayers", JSON.stringify(filenames));
            };
        })(file);

        reader.readAsText(file);
    }
    const layerConfig = {
        defaultRule: {
            styleContext: {
                strokeColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.strokeColor;
                },
                fillColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.fillColor;
                },
                labelOutlineColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.labelOutlineColor;
                },
                label: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.label;
                },
            },
            styleRules: [
                {
                    predicate: () => {
                        return true;
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                        strokeOpacity: 0.75,
                        strokeWidth: 3,
                        fillColor: "${fillColor}",
                        fillOpacity: 0.1,
                        pointRadius: 6,
                        fontColor: "white",
                        labelOutlineColor: "${labelOutlineColor}",
                        labelOutlineWidth: 4,
                        labelAlign: "center",
                        label: "${label}",
                    },
                },
            ],
        },
    };

    function polygonSanitization(f: GeoJSON.Feature<Polygon>): GeoJSON.Feature<Polygon> {
        // Rewind first:
        f = rewind.rewindFeature(f, "RFC7946");
        let resPolygonCoordinates: Position[][] = [];
        for (const poly of f.geometry.coordinates) {
            let resSubPolyCoordinates: Position[] = [];
            let positionMap: Map<string, number[]> = new Map<string, number[]>();
            for (let ix: number = 0; ix < poly.length - 1; ++ix) {
                let key: string = poly[ix].toString();
                if (positionMap.has(key)) {
                    positionMap.get(key)?.push(ix);
                } else {
                    positionMap.set(key, [ix]);
                }
                resSubPolyCoordinates.push(poly[ix]);
            }
            resSubPolyCoordinates.push(resSubPolyCoordinates[0]);
            let removeSpliced: boolean = false;
            positionMap.forEach(function (value: number[], key: string, map: Map<string, number[]>) {
                if (value.length > 1) {
                    if (value.length % 2 !== 0) {
                        let message = `Currently Polygons with multiple intersects of the same vertex are not supported.
                             They have to be splittable into distinct Polygons.
                             Please contact script maintainers for bug fix with original Data Source`;
                        console.error(message);
                        throw new Error(message);
                    }
                    for (let vix: number = 0; vix < value.length; vix += 2) {
                        if (value[vix + 1] - value[vix] > 1) {
                            resPolygonCoordinates.push(resSubPolyCoordinates.slice(value[vix], value[vix + 1] + 1));
                        }
                        resSubPolyCoordinates.fill([], value[vix] + 1, value[vix + 1] + 1);
                        removeSpliced = true;
                    }
                }
            });
            if (removeSpliced) {
                for (let i = 0; i < resSubPolyCoordinates.length; ++i) {
                    if (resSubPolyCoordinates[i].length === 0) {
                        resSubPolyCoordinates.splice(i, 1);
                        --i;
                    }
                }
            }
            if (resSubPolyCoordinates.length > 3) {
                resPolygonCoordinates.push(resSubPolyCoordinates);
            }
        }
        return turf.polygon(resPolygonCoordinates, f.properties, { id: f.id });
    }

    function remove3DPoints(
        feature: GeoJSON.Feature<Point | LineString | Polygon>
    ): GeoJSON.Feature<Point | LineString | Polygon> | undefined {
        let resFeature: Feature<Point | LineString | Polygon> | undefined = undefined;
        switch (feature.geometry.type) {
            case "Point":
                feature.geometry.coordinates.splice(2);
                resFeature = feature;
                break;
            case "LineString":
                let lsPos: Position[] = feature.geometry.coordinates.map((pos: Position) =>
                    pos.splice(2) === undefined ? pos : pos
                );
                resFeature = turf.lineString(lsPos, feature.properties, { bbox: feature.bbox, id: feature.id });
                break;
            case "Polygon":
                let polyPos: Position[][] = feature.geometry.coordinates.map((poly) =>
                    poly.map((pos) => pos.splice(2) ? pos : pos) ? poly : poly
                );
                resFeature = turf.polygon(polyPos, feature.properties, { bbox: feature.bbox, id: feature.id });
                break;
            default:
                let msg = "Unsupported Type of Feature for 3D Points Removal";
                console.log(msg);
        }
        return resFeature;
    }

    let sanityChecker = {
        polygon: polygonSanitization,
    };

    function sanityCheck(source: GeoJSON.Feature[]): GeoJSON.Feature[] | undefined {
        let resFeatures: GeoJSON.Feature[] | undefined = [];

        for (let f of source) {
            f = remove3DPoints(f);
            switch (f.geometry.type) {
                case "Polygon":
                    resFeatures.push(sanityChecker.polygon(f));
                    break;
                default:
                    resFeatures.push(f);
                    break;
            }
        }

        return resFeatures.length === 0 ? undefined : resFeatures;
    }

    // Renders a layer object
    function parseFile(layerObj: LayerStoreObj) {
        // add a new layer for the geometry
        var layerid = "wme_geometry_" + ++layerindex;
        sdk.Map.addLayer({
            layerName: layerid,
            styleRules: layerConfig.defaultRule.styleRules,
            styleContext: layerConfig.defaultRule.styleContext,
        });
        sdk.Map.setLayerVisibility({ layerName: layerid, visibility: true });
        sdk.LayerSwitcher.addLayerCheckbox({ name: layerid });
        let features: GeoJSON.Feature[] | undefined = [];
        if (layerObj.fileContent) {
            switch (layerObj.formatType) {
                case "GEOJSON":
                    let jsonObject: GeoJSON.FeatureCollection = JSON.parse(layerObj.fileContent);
                    {
                        jsonObject = turf.flatten(jsonObject);
                        features = sanityCheck(jsonObject.features);
                    }
                    // geometryLayers[layerid] = features;
                    break;
                case "KML":
                    let kmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                    let geoJson: GeoJSON.FeatureCollection = toGeoJSON.kml(kmlData);
                    {
                        geoJson = turf.flatten(geoJson);
                        features = sanityCheck(geoJson.features);
                    }
                    // geometryLayers[layerid] = features;
                    break;
                case "GPX":
                    let gpxData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                    let gpxGeoGson: GeoJSON.FeatureCollection = toGeoJSON.gpx(gpxData);
                    {
                        gpxGeoGson = turf.flatten(gpxGeoGson);
                        features = sanityCheck(gpxGeoGson.features);
                    }
                    // geometryLayers[layerid] = features;
                    break;
                case "WKT":
                    const wktGeoJson = Terraformer.wktToGeoJSON(layerObj.fileContent);
                    switch (wktGeoJson.type) {
                        case "Polygon":
                            features = sanityCheck([
                                {
                                    type: "Feature",
                                    properties: { name: layerObj.fileName },
                                    geometry: wktGeoJson,
                                },
                            ]);
                            break;
                        case "GeometryCollection":
                            features = [];
                            for (let g in wktGeoJson.geometries) {
                                features.push({
                                    type: "Feature",
                                    properties: { name: layerObj.fileName },
                                    geometry: wktGeoJson.geometries[g],
                                });
                            }
                            let featureCollection: GeoJSON.FeatureCollection = turf.featureCollection(features);
                            featureCollection = turf.flatten(featureCollection);
                            features = sanityCheck(featureCollection.features);
                            break;
                        default:
                            let errorMessage = "Unknown Type has been Encountered";
                            console.error(errorMessage);
                            throw Error(errorMessage);
                    }
                    break;
                case "GML":
                    // let gmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                    let gmlGeoJSON: GeoJSON.FeatureCollection = gml2geojson.parseGML(layerObj.fileContent);
                    {
                        gmlGeoJSON = turf.flatten(gmlGeoJSON);
                        features = sanityCheck(gmlGeoJSON.features);
                    }
                    // geometryLayers[layerid] = features;
                    break;
                default:
                    throw new Error(`Format Type: ${layerObj.formatType} is not implemented`);
            }
        } else {
            throw new Error("File Content is Empty");
        }

        geometryLayers.add(layerid);

        // hack in translation:
        // I18n.translations[sdk.Settings.getLocale()].layers.name[layerid] = "WME Geometries: " + layerObj.filename;

        // if (/"EPSG:3857"|:EPSG::3857"/.test(layerObj.fileContent)) {
        //     parser.externalProjection = EPSG_3857;
        // }
        // else if (/"EPSG:4269"|:EPSG::4269"/.test(layerObj.fileContent)) {
        //     parser.externalProjection = EPSG_4269;
        // }
        // else default to EPSG:4326

        // load geometry files
        // var features = parser.read(layerObj.fileContent);

        // Append Div for Future Use for picking the Layer with Name
        let layersList = document.createElement("ul");
        layersList.className = "geometries-cb-list";
        layersList.id = checkboxListID;
        let trigger = null;
        // check we have features to render
        if (!features) return;
        if (features.length > 0) {
            // check which attribute can be used for labels
            var labelWith: string = "(no labels)";
            for (const attrib in features[0].properties) {
                let attribLC = attrib.toLowerCase();
                let attribClassName = `geometries-${layerindex}-` + attribLC;
                let attribIdName = `geometries-${layerindex}-` + attribLC;
                let listElement = document.createElement("li");
                let inputElement = document.createElement("input");
                inputElement.className = attribClassName;
                inputElement.id = attribIdName;
                inputElement.setAttribute("type", "radio");
                inputElement.setAttribute("name", `geometries-name-label-${layerindex}`);
                inputElement.textContent = attrib;
                listElement.appendChild(inputElement);
                let labelElement = document.createElement("label");
                labelElement.textContent = attrib;
                labelElement.className = "geometries-cb-label";
                labelElement.setAttribute("for", attribIdName);
                labelElement.style.color = "black";
                listElement.appendChild(labelElement);
                layersList.appendChild(listElement);
                $(inputElement).on("change", function (event: JQuery.TriggeredEvent) {
                    addFeatures(features, event);
                });
                if (selectedAttrib && selectedAttrib === attrib) {
                    trigger = $(inputElement);
                } else if (!selectedAttrib && defaultLabelName.test(attribLC) === true) {
                    trigger = $(inputElement);
                }
            }
        }

        if (trigger) {
            trigger[0].checked = true;
            trigger.trigger("change");
        }

        function createClearButton(layerObj: LayerStoreObj, layerid: string): HTMLButtonElement {
            let clearButtonObject = document.createElement("button");
            clearButtonObject.textContent = "Clear Layer";
            clearButtonObject.name = "clear-" + (layerObj.fileName + "." + layerObj.fileExt).toLowerCase();
            clearButtonObject.id = "clear-" + layerid;
            clearButtonObject.className = "clear-layer-button";
            clearButtonObject.style.backgroundColor = layerObj.color;
            return clearButtonObject;
        }
        // When called as part of loading a new file, the list object will already have been created,
        // whereas if called as part of reloding cached data we need to create it here...
        var liObj = document.getElementById((layerObj.fileName + "." + layerObj.fileExt).toLowerCase());
        if (liObj === null) {
            liObj = document.createElement("li");
            liObj.id = (layerObj.fileName + "." + layerObj.fileExt).toLowerCase();
            liObj.style.color = layerObj.color;
            geolist.appendChild(liObj);
        }

        if (features.length === 0) {
            liObj.innerHTML = "No features loaded :(";
            liObj.style.color = "red";
        } else {
            liObj.innerHTML = layerObj.fileName;
            liObj.title =
                layerObj.fileExt.toUpperCase() +
                // " " +
                // parser.externalProjection.projCode +
                ": " +
                features.length +
                " features loaded\n" +
                labelWith;
            liObj.appendChild(layersList);
            let clearButtonObject = createClearButton(layerObj, layerid);
            liObj.appendChild(clearButtonObject);
            console.info("WME Geometries: Loaded " + liObj.title);
            $(".clear-layer-button").on("click", function () {
                let clearLayerId: string = this.id;
                clearLayerId = clearLayerId.replace("clear-", "");
                let clearListId: string | null | undefined = "";
                if (this.hasAttribute("name")) {
                    clearListId = this.getAttribute("name");
                    clearListId = clearListId?.replace("clear-", "");
                    if (clearListId) {
                        let elem = document.getElementById(clearListId);
                        elem?.remove();
                    }
                }
                sdk.Map.removeLayer({ layerName: clearLayerId });
                geometryLayers.delete(clearLayerId);
                sdk.LayerSwitcher.removeLayerCheckbox({ name: clearLayerId });
                let listId: string | undefined = this.textContent?.replace("Clear ", "");
                if (!listId) return;
                let elementToRemove = document.getElementById(listId);
                elementToRemove?.remove();
                let files: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
                delete files[this.style.backgroundColor];
                localStorage.setItem("WMEGeoLayers", JSON.stringify(files));
                usedColors.delete(this.style.backgroundColor);
                colorList.add(this.style.backgroundColor);
                this.remove();
            });
        }

        function addFeatures(features: GeoJSON.Feature[], event: JQuery.TriggeredEvent) {
            sdk.Map.removeAllFeaturesFromLayer({ layerName: layerid });
            selectedAttrib = event.target.textContent;
            for (let f of features) {
                if (f.properties) {
                    labelWith = "Labels: " + selectedAttrib;
                    let layerStyle = {
                        strokeColor: layerObj.color,
                        fillColor: layerObj.color,
                        labelOutlineColor: layerObj.color,
                        label:
                            typeof f.properties[selectedAttrib] === "string"
                                ? `${f.properties[selectedAttrib]}`
                                : "undefined",
                    };
                    if (!f.properties?.style) f.properties.style = {};
                    Object.assign(f.properties.style, layerStyle);
                }

                if (!f.id) {
                    f.id = layerid + "_" + layerindex.toString();
                }
                try {
                    sdk.Map.addFeatureToLayer({ feature: f, layerName: layerid });
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    // clear all
    function removeGeometryLayers() {
        for (const l in geometryLayers) {
            sdk.Map.removeLayer({ layerName: l });
            sdk.LayerSwitcher.removeLayerCheckbox({ name: l });
        }

        geometryLayers.clear();
        geolist.innerHTML = "";
        layerindex = 0;
        // Clear the cached layers
        localStorage.removeItem("WMEGeoLayers");
        for (const c in usedColors) {
            colorList.add(c);
        }
        usedColors.clear();
        return false;
    }
}

// // ------------------------------------------------------------------------------------
