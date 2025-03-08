// ==UserScript==
// @name                WME Geometries
// @version             2025.03.05.002
// @description         Import geometry files into Waze Map Editor. Supports GeoJSON, GML, WKT, KML and GPX.
// @match               https://www.waze.com/*/editor*
// @match               https://www.waze.com/editor*
// @match               https://beta.waze.com/*
// @exclude             https://www.waze.com/*user/*editor/*
// @require             https://cdn.jsdelivr.net/npm/@tmcw/togeojson@6.0.0/dist/togeojson.umd.min.js
// @require             https://unpkg.com/@terraformer/wkt
// @require             https://cdn.jsdelivr.net/npm/gml2geojson@0.0.7/dist/gml2geojson.min.js
// @require             https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @require             https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
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
// import { WmeSDK } from "wme-sdk-typings";
// import * as toGeoJSON from "@tmcw/togeojson";
// import * as Terraformer from "@terraformer/wkt";
// import * as turf from "@turf/turf";
// import { GeoJsonProperties, Polygon, Position } from "geojson";
// import WazeWrap from "https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js";
window.SDK_INITIALIZED.then(geometries);
function geometries() {
    const GF_LINK = "https://greasyfork.org/en/scripts/8129-wme-geometries";
    const FORUM_LINK = "https://www.waze.com/discuss/t/script-wme-geometries-v1-7-june-2021/291428/8";
    const GEOMETRIES_UPDATE_NOTES = `<b>NEW:</b><br>
    - Converted to WME SDK<br>
    - Added ability to remove individual layers<br>
    - Added ability to select field to display as label for the added shape.<br><br>
<b>KNOWN ISSUES:</b><br>
    - Label Property is a radio Button vs ability to select multiple properties.<br>
    - Draw State Boundary is no longer available<br>
    - Some 3rd Party Data Files may cause issues for display<br>
    - 3D Points are not Supported. (LAT, LON, ALT)<br><br>
`;
    // show labels using first attribute that starts or ends with 'name' (case insensitive regexp)
    var defaultLabelName = /^name|name$/;
    // each loaded file will be rendered with one of these colours in ascending order
    var colorList = new Set(["deepskyblue", "magenta", "limegreen", "orange", "teal", "navy", "maroon"]);
    let usedColors = new Set();
    // Id of div element for Checkboxes:
    const checkboxListID = "geometries-cb-list-id";
    let geometryLayers = {};
    let parser;
    let Formats;
    (function (Formats) {
        Formats[Formats["GEOJSON"] = 0] = "GEOJSON";
        Formats[Formats["KML"] = 1] = "KML";
        Formats[Formats["WKT"] = 2] = "WKT";
        Formats[Formats["GML"] = 3] = "GML";
        Formats[Formats["GMX"] = 4] = "GMX";
    })(Formats || (Formats = {}));
    let formathelp = "GeoJSON, KML, WKT, GPX, GML";
    var layerindex = 0;
    let selectedAttrib = "";
    if (!window.getWmeSdk) {
        throw new Error("SDK is not installed");
    }
    const sdk = window.getWmeSdk({
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
        fileContent;
        color;
        fileExt;
        fileName;
        formatType;
        constructor(fileContent, color, fileext, filename) {
            this.fileContent = fileContent;
            this.color = color;
            this.fileExt = fileext;
            this.fileName = filename;
            this.formatType = fileext.toUpperCase();
        }
    }
    var geolist;
    function loadLayers() {
        // Parse any locally stored layer objects
        let files = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
        for (const f in files)
            processGeometryFile(files[f]);
    }
    // add interface to Settings tab
    function init() {
        if (!WazeWrap.Ready) {
            setTimeout(() => {
                init();
            }, 100);
            return;
        }
        var geobox = document.createElement("div");
        geobox.style.paddingTop = "6px";
        console.group();
        let sidepanelAreas = $("#sidepanel-areas");
        sidepanelAreas.append(geobox);
        var geotitle = document.createElement("h4");
        geotitle.innerHTML = "Import Geometry File";
        geobox.appendChild(geotitle);
        geolist = document.createElement("ul");
        geobox.appendChild(geolist);
        var geoform = document.createElement("form");
        geobox.appendChild(geoform);
        var inputfile = document.createElement("input");
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
        WazeWrap.Interface.ShowScriptUpdate(GM_info.script.name, GM_info.script.version, GEOMETRIES_UPDATE_NOTES, GF_LINK, FORUM_LINK);
        console.log("WME Geometries is now available....");
        console.groupEnd();
    }
    function addFormat(format) {
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
        var fileList = document.getElementById("GeometryFile");
        if (!fileList)
            return;
        var file = fileList.files[0];
        fileList.value = "";
        processGeometryFile(file);
    }
    function processGeometryFile(file) {
        if (colorList.size === 0) {
            console.error("Cannot add Any more Layers at this point");
        }
        var fileext = file?.name?.split(".").pop();
        var filename = file?.name?.replace("." + fileext, "");
        if (!file || !file?.name || !fileext || !filename)
            return;
        fileext = fileext ? fileext.toUpperCase() : "";
        // add list item
        var color = colorList.values().next().value;
        if (!color) {
            console.error("Cannot add Any more Layers at this point");
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
        reader.onload = (function (theFile) {
            return function (e) {
                var tObj = new LayerStoreObj(e.target.result, color, fileext, filename);
                parseFile(tObj);
                let filenames = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
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
                    if (!style)
                        return style;
                    return style?.strokeColor;
                },
                fillColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style)
                        return style;
                    return style?.fillColor;
                },
                labelOutlineColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style)
                        return style;
                    return style?.labelOutlineColor;
                },
                label: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style)
                        return style;
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
    function polygonSanitization(f) {
        let resPolygonCoordinates = [];
        for (const poly of f.geometry.coordinates) {
            let resSubPolyCoordinates = [];
            let positionMap = new Map();
            for (let ix = 0; ix < poly.length - 1; ++ix) {
                let key = poly[ix].toString();
                if (positionMap.has(key)) {
                    positionMap.get(key)?.push(ix);
                }
                else {
                    positionMap.set(key, [ix]);
                }
                resSubPolyCoordinates.push(poly[ix]);
            }
            resSubPolyCoordinates.push(resSubPolyCoordinates[0]);
            let removeSpliced = false;
            positionMap.forEach(function (value, key, map) {
                if (value.length > 1) {
                    if (value.length % 2 !== 0) {
                        let message = `Currently Polygons with multiple intersects of the same vertex are not supported.
                             They have to be splittable into distinct Polygons.
                             Please contact script maintainers for bug fix with original Data Source`;
                        console.error(message);
                        throw new Error(message);
                    }
                    for (let vix = 0; vix < value.length; vix += 2) {
                        resPolygonCoordinates.push(resSubPolyCoordinates.slice(value[vix], value[vix + 1] + 1));
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
            resPolygonCoordinates.push(resSubPolyCoordinates);
        }
        return turf.polygon(resPolygonCoordinates, f.properties, { id: f.id });
    }
    let sanityChecker = {
        polygon: polygonSanitization,
    };
    function sanityCheck(source) {
        let resFeatures = [];
        for (const f of source) {
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
    function parseFile(layerObj) {
        // add a new layer for the geometry
        var layerid = "wme_geometry_" + ++layerindex;
        sdk.Map.addLayer({
            layerName: layerid,
            styleRules: layerConfig.defaultRule.styleRules,
            styleContext: layerConfig.defaultRule.styleContext,
        });
        sdk.Map.setLayerVisibility({ layerName: layerid, visibility: true });
        sdk.LayerSwitcher.addLayerCheckbox({ name: layerid });
        let features = [];
        switch (layerObj.formatType) {
            case "GEOJSON":
                let jsonObject = JSON.parse(layerObj.fileContent);
                {
                    jsonObject = turf.flatten(jsonObject);
                    features = sanityCheck(jsonObject.features);
                }
                geometryLayers[layerid] = features;
                break;
            case "KML":
                let kmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let geoJson = toGeoJSON.kml(kmlData);
                {
                    geoJson = turf.flatten(geoJson);
                    features = sanityCheck(geoJson.features);
                }
                geometryLayers[layerid] = features;
                break;
            case "GPX":
                let gpxData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let gpxGeoGson = toGeoJSON.gpx(gpxData);
                {
                    gpxGeoGson = turf.flatten(gpxGeoGson);
                    features = sanityCheck(gpxGeoGson.features);
                }
                geometryLayers[layerid] = features;
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
                        let featureCollection = turf.featureCollection(features);
                        featureCollection = turf.flatten(featureCollection);
                        features = sanityCheck(featureCollection.features);
                        break;
                    default:
                        let errorMessage = "Unknown Type has been Encountered";
                        console.error(errorMessage);
                        throw Error(errorMessage);
                        break;
                }
                break;
            case "GML":
                // let gmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let gmlGeoJSON = gml2geojson.parseGML(layerObj.fileContent);
                {
                    gmlGeoJSON = turf.flatten(gmlGeoJSON);
                    features = sanityCheck(gmlGeoJSON.features);
                }
                geometryLayers[layerid] = features;
                break;
            default:
                throw new Error(`Format Type: ${layerObj.formatType} is not implemented`);
        }
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
        if (features.length > 0) {
            // check which attribute can be used for labels
            var labelWith = "(no labels)";
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
                // let selectorString = "<li><input type=radio class='" + attribClassName + "' id='" +
                //     attribIdName + "' name='geometries-name-label'/>" +
                //     "<label class='geometries-cb-label'>" + attrib + "</label></li>"
                layersList.appendChild(listElement);
                $(inputElement).on("change", function (event) {
                    addFeatures(features, event);
                });
                if (selectedAttrib && selectedAttrib === attrib) {
                    trigger = $(inputElement);
                }
                else if (!selectedAttrib && defaultLabelName.test(attribLC) === true) {
                    trigger = $(inputElement);
                }
            }
        }
        if (trigger) {
            trigger[0].checked = true;
            trigger.trigger("change");
        }
        function createClearButton(layerObj, layerid) {
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
        }
        else {
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
                let clearLayerId = this.id;
                clearLayerId = clearLayerId.replace("clear-", "");
                let clearListId = "";
                if (this.hasAttribute("name")) {
                    clearListId = this.getAttribute("name");
                    clearListId = clearListId?.replace("clear-", "");
                    if (clearListId) {
                        let elem = document.getElementById(clearListId);
                        elem?.remove();
                    }
                }
                sdk.Map.removeLayer({ layerName: clearLayerId });
                delete geometryLayers[clearLayerId];
                sdk.LayerSwitcher.removeLayerCheckbox({ name: clearLayerId });
                let listId = this.textContent?.replace("Clear ", "");
                if (!listId)
                    return;
                let elementToRemove = document.getElementById(listId);
                elementToRemove?.remove();
                let files = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
                delete files[this.style.backgroundColor];
                localStorage.setItem("WMEGeoLayers", JSON.stringify(files));
                usedColors.delete(this.style.backgroundColor);
                colorList.add(this.style.backgroundColor);
                this.remove();
            });
        }
        function addFeatures(features, event) {
            sdk.Map.removeAllFeaturesFromLayer({ layerName: layerid });
            selectedAttrib = event.target?.textContent;
            for (let f of features) {
                if (f.properties) {
                    labelWith = "Labels: " + selectedAttrib;
                    let layerStyle = {
                        strokeColor: layerObj.color,
                        fillColor: layerObj.color,
                        labelOutlineColor: layerObj.color,
                        label: typeof f.properties[selectedAttrib] === "string"
                            ? `${f.properties[selectedAttrib]}`
                            : "undefined",
                    };
                    if (!f.properties?.style)
                        f.properties.style = {};
                    Object.assign(f.properties.style, layerStyle);
                }
                if (!f.id) {
                    f.id = layerid + "_" + layerindex.toString();
                }
                sdk.Map.addFeatureToLayer({ feature: f, layerName: layerid });
            }
        }
    }
    // clear all
    function removeGeometryLayers() {
        for (const l in geometryLayers) {
            sdk.Map.removeLayer({ layerName: l });
            sdk.LayerSwitcher.removeLayerCheckbox({ name: l });
        }
        geometryLayers = {};
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
