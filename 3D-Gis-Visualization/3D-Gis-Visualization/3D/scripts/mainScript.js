"use strict";

// Qgis2threejs.js
// (C) 2014 Minoru Akagi | MIT License
// https://github.com/minorua/Qgis2threejs
//Export page edited and altered by Nicolai Mogensen and Adam Emil Paltorp Schmitt for DTU


var Q3D = { VERSION: "1.4" };
Q3D.Options = {
  bgcolor: null,
  light: {
    directional: {
      azimuth: 220,   // note: default light azimuth of gdaldem hillshade is 315.
      altitude: 65    // altitude angle
    }
  },
    side: { color: 0xc7ac92, bottomZ: -1.5 },
    frame: { color: 0, bottomZ: -1.5 },
    qmarker: { r: 0.25, c: 0xffff00, o: 0.8 },
  debugMode: false,
  exportMode: false,
  jsonLoader: "JSONLoader"  // JSONLoader or ObjectLoader
};

Q3D.LayerType = { DEM: "dem", Point: "point", Line: "line", Polygon: "polygon" };
Q3D.MaterialType = { MeshLambert: 0, MeshPhong: 1, LineBasic: 2, Sprite: 3, Unknown: -1 };
Q3D.uv = { i: new THREE.Vector3(1, 0, 0), j: new THREE.Vector3(0, 1, 0), k: new THREE.Vector3(0, 0, 1) };

Q3D.ua = window.navigator.userAgent.toLowerCase();
Q3D.isIE = (Q3D.ua.indexOf("msie") != -1 || Q3D.ua.indexOf("trident") != -1);
Q3D.isTouchDevice = ("ontouchstart" in window);

Q3D.$ = function (elementId) {
  return document.getElementById(elementId);
};

/*
Q3D.Project - Project data holder

params: title, crs, proj, baseExtent, rotation, width, zExaggeration, zShift, wgs84Center
*/
Q3D.Project = function (params) {
  for (var k in params) {
    this[k] = params[k];
  }

  var w = (this.baseExtent[2] - this.baseExtent[0]),
      h = (this.baseExtent[3] - this.baseExtent[1]);

  this.height = this.width * h / w;
  this.scale = this.width / w;
  this.zScale = this.scale * this.zExaggeration;

    this.origin = {
        x: this.baseExtent[0] + w / 2,
                 y: this.baseExtent[1] + h / 2,
        z: -this.zShift
    };

  this.layers = [];
  this.models = [];
  this.images = [];
};

Q3D.Project.prototype = {

  constructor: Q3D.Project,

  addLayer: function (layer) {
    layer.index = this.layers.length;
    layer.project = this;
    this.layers.push(layer);
    return layer;
  },

  layerCount: function () {
    return this.layers.length;
  },

  getLayerByName: function (name) {
    for (var i = 0, l = this.layers.length; i < l; i++) {
      var layer = this.layers[i];
      if (layer.name == name) return layer;
    }
    return null;
  },

  _rotatePoint: function (point, degrees, origin) {
    // Rotate point around the origin
    var theta = degrees * Math.PI / 180,
        c = Math.cos(theta),
        s = Math.sin(theta),
        x = point.x,
        y = point.y;

    if (origin) {
      x -= origin.x;
      y -= origin.y;
    }

    // rotate counter-clockwise
    var xd = x * c - y * s,
        yd = x * s + y * c;

    if (origin) {
      xd += origin.x;
      yd += origin.y;
    }
        return { x: xd, y: yd };
  },

  toMapCoordinates: function (x, y, z) {
    if (this.rotation) {
            var pt = this._rotatePoint({ x: x, y: y }, this.rotation);
      x = pt.x;
      y = pt.y;
    }
        return {
            x: x / this.scale + this.origin.x,
            y: y / this.scale + this.origin.y,
            z: z / this.zScale + this.origin.z
        };
  }
};


/*
Q3D.application

limitations:
- one renderer
- one scene
*/
(function () {
    // the application
    var app = {};
    Q3D.application = app;

    app.init = function (container) {

        //FPS Counter
        app.stats = new Stats();
        app.stats.setMode(0); // 0: fps, 1: ms, 2: mb

        // align top-left
        app.stats.domElement.style.position = 'absolute';
        app.stats.domElement.style.left = '0px';
        app.stats.domElement.style.top = '0px';

        document.body.appendChild(app.stats.domElement);

        app.INTERSECTED = null;
        app.mouse = new THREE.Vector2();

        app.container = container;
        app.running = false;

        // URL parameters
        app.urlParams = app.parseUrlParameters();
        if ("popup" in app.urlParams) {
            // open popup window
            var c = window.location.href.split("?");
            window.open(c[0] + "?" + c[1].replace(/&?popup/, ""), "popup", "width=" + app.urlParams.width + ",height=" + app.urlParams.height);
            app.popup.show("Another window has been opened.");
            return;
        }

        if (app.urlParams.width && app.urlParams.height) {
            // set container size
            container.style.width = app.urlParams.width + "px";
            container.style.height = app.urlParams.height + "px";
        }

        if (container.clientWidth && container.clientHeight) {
            app.width = container.clientWidth;
            app.height = container.clientHeight;
            app._fullWindow = false;
        } else {
            app.width = window.innerWidth;
            app.height = window.innerHeight;
            app._fullWindow = true;
        }

        // WebGLRendereraddcustom
        var bgcolor = Q3D.Options.bgcolor;
        app.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        app.renderer.shadowMapEnabled = true;
        app.renderer.setSize(app.width, app.height);
        app.renderer.setClearColor(bgcolor || 0, (bgcolor === null) ? 0 : 1);
        app.container.appendChild(app.renderer.domElement);

        // scene
        app.scene = new THREE.Scene();
        app.scene.autoUpdate = true;
        //Fog
        app.scene.fog = new THREE.Fog(0xddddff, 0.1, 550);

        //Clickable objects that has attributes (buildings etc.)
        app._queryableObjects = [];
        app.queryObjNeedsUpdate = true;

        app.modelBuilders = [];
        app._wireframeMode = false;


        var url = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";

        window.scene = app.scene;
    };

    app.parseUrlParameters = function () {
        var p, vars = {};
        var params = window.location.search.substring(1).split('&').concat(window.location.hash.substring(1).split('&'));
        params.forEach(function (param) {
            p = param.split('=');
            vars[p[0]] = p[1];
        });
        return vars;
    };

    /*
    Saves the current active project to appropriately formated JSON containing all information nescessary to rebuild it
    */
    app.saveProject = function (name) {
        var project = app.project;

        //vanilla project without any layers.
        var savedProject = {
            title: name,
            creator: "Builder",
            layers: [],
            planeData: {},
            crs: project.crs,
            origin: project.origin,
            baseExtent: project.baseExtent,
            height: project.height,
            width: project.width,
            scale: project.scale,
            zExaggeration: 1.5,
            zScale: 0.0606550748079256,
            zShift: 0,
        };


        /*
        Save an object that describes the planes
        */
        var planeData = { tileWidth: (Math.sqrt((app.project.plane.length - 1)) - 1) / 2, planes: [{ detail: {} }] };

        //Iterate over the planes to fill out the planeData accordingly
        project.plane.forEach(function (plane, i) {
            //Initialize the plane object   
            planeData.planes[i] = { detail: {} };

            if (plane.layers !== undefined) {
                //If the plane has layers, we need to check if they have been visualized
                //If they have, we save the geometry, else we save the url so we can load it in dynamically
                plane.layers.forEach(function (layer, j) {
                    //We have a layer with geometry on the plane
                    if (layer.model != undefined) {
                        var models = [];
                        var blocks = [];
                        var a = [];
                        //If the layer has been visualised, save it
                        if (plane.detail.layers[j].viz == true) {

                            layer.model.forEach(function (model, k) {
                                var geo = new THREE.Geometry();
                                geo.vertices = model.geometry.vertices;
                                geo.faces = model.geometry.faces;
                                model.geometry = geo;
                                var result = model.toJSON();
                                var resultJSON = JSON.stringify(result);
                                models.push(resultJSON);
                                a.push(layer.a[k]);

                                //If blocks were used to visualize, save them
                                if (layer.block != undefined) {
                                    var result2 = layer.block[k].toJSON();
                                    var resultJSON2 = JSON.stringify(result2);
                                    blocks.push(resultJSON2);
                                }
                            });
                            if (j == 0) {
                                planeData.planes[i].layers = [];
                            }
                            planeData.planes[i].layers[j] = {};
                            planeData.planes[i].layers[j].a = a;
                            planeData.planes[i].layers[j].model = models;
                            planeData.planes[i].layers[j].name = plane.layers[j].name;
                            planeData.planes[i].layers[j].type = plane.layers[j].type;
                            planeData.planes[i].layers[j].features = plane.layers[j].features;
                            planeData.planes[i].layers[j].crs = plane.layers[j].crs;
                            planeData.planes[i].layers[j].block = blocks;
                            planeData.planes[i].layers[j].maxmin = plane.layers[j].maxmin;

                        } else {  //If Viz is not true, we create an empty shell for the layer, which the GeoJSON will use on load
                            planeData.planes[i].layers = [];
                        }
                    } else {
                        //If the plane does not contain models, it is "deleted" so we save the reference, to maintain index
                        layer = [];
                    }

                });
            }
            var models = [];
            var a = [];
            var blocks = [];
            var userData = [];
            //If the plane has buildings
            if (plane.buildings !== undefined) {

                //Only save the meshes if details specify it
                //We also save when addresses has been built, because it takes a !long! time during run
                //Speed > space
                if (plane.detail.address == true) {

                    //If the plane has buildings, we have to save it into planeData
                    plane.buildings.model.forEach(function (model, i) {
                        //Save the userdata, as it gets lost on .toJSON();
                        userData.push(model.userData);
                        var geo = new THREE.Geometry();
                        geo.vertices = model.geometry.vertices;
                        geo.faces = model.geometry.faces;
                        model.geometry = geo;

                        var result = model.toJSON();
                        var resultJSON = JSON.stringify(result);
                        models.push(resultJSON);
                        a.push(plane.buildings.a[i]);
                    });
                    //Iterate over the blocks if there are any
                    if (plane.buildings.block != undefined) {
                        plane.buildings.block.forEach(function (block) {
                            var result = block.toJSON();
                            var resultJSON = JSON.stringify(result);
                            blocks.push(resultJSON);
                        });
                    }

                    var model = plane.buildings.mergeMesh;
                    var geo = new THREE.Geometry();
                    geo.vertices = plane.buildings.mergeMesh.geometry.vertices;
                    geo.faces = plane.buildings.mergeMesh.geometry.faces;
                    model.geometry = geo;


                    planeData.planes[i].buildings = {};
                    planeData.planes[i].buildings.a = a;
                    planeData.planes[i].buildings.model = models;
                    planeData.planes[i].buildings.name = plane.buildings.name;
                    planeData.planes[i].buildings.type = plane.buildings.type;
                    planeData.planes[i].buildings.url = plane.buildings.url;
                    planeData.planes[i].buildings.zip = plane.buildings.zip;
                    planeData.planes[i].buildings.userData = userData;
                    planeData.planes[i].buildings.block = blocks;
                    planeData.planes[i].buildings.maxmin = plane.buildings.maxmin;
                    //Actually we dont need to save the mergedMesh, as it is transitive
                    //planeData.planes[i].buildings.mergeMesh = JSON.stringify(model.toJSON());     
                }
            }
            planeData.planes[i].detail = plane.detail;
        });
        savedProject.planeData = planeData;

        return savedProject;

    }
    /*
    Loads a project from a JSON formatted file (has to be called from saveProject) (Implement a verification method)
    */
    app.loadProject = function (projectJSON) {
        projectJSON.baseExtent[0] = projectJSON.baseExtent[0];
        projectJSON.baseExtent[1] = projectJSON.baseExtent[1];
        projectJSON.baseExtent[2] = projectJSON.baseExtent[2];
        projectJSON.baseExtent[3] = projectJSON.baseExtent[3];

        var project = new Q3D.Project({
            crs: projectJSON.crs, title: projectJSON.title, baseExtent: projectJSON.baseExtent, rotation: projectJSON.rotation, zshift: projectJSON.zshift,
            width: projectJSON.width, height: projectJSON.height, zExaggeration: projectJSON.zExaggeration,
        });
        project.map = { url: "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&format=image%2Fpng&srs=EPSG%3A25832" }
        project.layers = projectJSON.layers;


        //Since this method can be called again, we need to completely wipe the THREE.JS scene for any children, lights, cameras. as these will be set up
        //We wipe clean, because it might be in a later version, that lights and camera settings can be included in the project
        app.scene.children.forEach(function (child) {
            app.octree.remove(child);
            app.scene.remove(child);
            child = null;
        });

        app.project = project;

        // light
        if (project.buildCustomLights) project.buildCustomLights(app.scene);
        else app.buildDefaultLights(app.scene);

        // camera
        if (project.buildCustomCamera) project.buildCustomCamera();
        else app.buildDefaultCamera();

        app.raycaster = new THREE.Raycaster();

        app.octree = new THREE.Octree({
            // uncomment below to see the octree (may impact the fps)
            // scene: app.scene,
            // when undeferred = true, objects are inserted immediately
            // instead of being deferred until next octree.update() call
            // this may decrease performance as it forces a matrix update
            undeferred: false,
            // set the max depth of tree
            depthMax: Infinity,
            // max number of objects before nodes split or merge
            objectsThreshold: 256,
            // percent between 0 and 1 that nodes will overlap each other
            // helps insert objects that lie over more than one node
            overlapPct: 0.1
        });

        // restore view (camera position and its target) from URL parameters
        var vars = app.urlParams;
        if (vars.cx !== undefined) app.camera.position.set(parseFloat(vars.cx), parseFloat(vars.cy), parseFloat(vars.cz));
        if (vars.ux !== undefined) app.camera.up.set(parseFloat(vars.ux), parseFloat(vars.uy), parseFloat(vars.uz));
        if (vars.tx !== undefined) app.camera.lookAt(parseFloat(vars.tx), parseFloat(vars.ty), parseFloat(vars.tz));

        // controls
        if (Q3D.Controls) {
            app.controls = Q3D.Controls.create(app.camera, app.renderer.domElement);
            if (vars.tx !== undefined) {
                app.controls.target.set(parseFloat(vars.tx), parseFloat(vars.ty), parseFloat(vars.tz));
                app.controls.target0.copy(app.controls.target);   // for reset
            }
        }

        // wireframe mode setting
        if ("wireframe" in app.urlParams) app.setWireframeMode(true);

        // create a marker for queried point
        var opt = Q3D.Options.qmarker;
        app.queryMarker = new THREE.Mesh(new THREE.SphereGeometry(opt.r),
                                              new THREE.MeshLambertMaterial({ color: opt.c, ambient: opt.c, opacity: opt.o, transparent: (opt.o < 1) }));
        app.queryMarker.visible = false;
        app.scene.add(app.queryMarker);

        // update matrix world here
        app.scene.updateMatrixWorld();

        app.highlightMaterial = new THREE.MeshLambertMaterial({ emissive: 0x999900, transparent: true, opacity: 0.5 });
        if (!Q3D.isIE) app.highlightMaterial.side = THREE.DoubleSide;    // Shader compilation error occurs with double sided material on IE11

        app.selectedLayerId = null;
        app.selectedFeatureId = null;
        app.highlightObject = null;

        //Generate the plane
        app.calculatebbox(1);
        app.extendMap(2, projectJSON.planeData);


        var loader = new THREE.ObjectLoader();
        var geoList = [];
        projectJSON.planeData.planes.forEach(function (plane, i) {
            if (plane.detail.resolution == true) {
               
                app.updateResolution(plane,plane.detail, 1, 512, 512);
            }
            if (plane.detail.address == true && plane.buildings !== undefined) {
                var models = [];
                var blocks = [];
                plane.buildings.model.forEach(function (model) {
                    var loadedGeometry = JSON.parse(model);
                    var loadedMesh = loader.parse(loadedGeometry);
                    models.push(loadedMesh);

                    var position = { x: 0, y: -2 };
                    var target = { x: 0, y: 0 };
                    var tween = new TWEEN.Tween(position).to(target, 2000);

                    tween.onUpdate(function () {
                        //loadedMesh.position.x = position.x;
                        loadedMesh.position.z = position.y;
                    });
                    tween.start();
                    if (plane.detail.buildings == 2) {
                        app.octree.add(loadedMesh);
                    }


                });


                if (plane.buildings.block != undefined) {
                    plane.buildings.block.forEach(function (block) {
                        var loadedGeometry = JSON.parse(block);
                        var loadedMesh = loader.parse(loadedGeometry);
                        blocks.push(loadedMesh);
                        var position = { x: 0, y: -5 };
                        var target = { x: 0, y: 0 };
                        var tween = new TWEEN.Tween(position).to(target, 5000);

                        tween.onUpdate(function () {
                            //loadedMesh.position.x = position.x;
                            loadedMesh.position.z = position.y;
                        });
                        tween.start();

                        app.scene.add(loadedMesh);
                    });
                }

                //Assign the userData back to buildings
                for (var x = 0; x < models.length; x++) {
                    models[x].userData = plane.buildings.userData[x];
                }
                plane.buildings.model = models;
                plane.buildings.block = blocks;
           
                app.mergeBuilding(plane, 1);
            }

            if (plane.layers != undefined) {
                plane.detail.layers.forEach(function (layer, j) {
                    if (plane.detail.layers[j].viz == false) {
                        //Note down that we have to call this on this layer after we assign all the layers
                        geoList.push({ i: i, url: plane.detail.layers[j].url });

                    } else {
                        //If viz is true, load the object from the file
                        var models = [];
                        var blocks = [];
                        if (plane.layers[j] != undefined) {
                            

                            if (plane.layers[j].model != undefined) {


                                plane.layers[j].model.forEach(function (model, k) {
                                    var loadedGeometry = JSON.parse(model);
                                    var loadedMesh = loader.parse(loadedGeometry);
                                    models.push(loadedMesh);
                                    app.scene.add(loadedMesh);
                                    if (plane.layers[j].block[k] != undefined) {
                                        var loadedGeometry2 = JSON.parse(plane.layers[j].block[k]);
                                        var loadedMesh2 = loader.parse(loadedGeometry2);
                                        blocks.push(loadedMesh2);
                                        app.scene.add(loadedMesh2);
                                    }
                                });
                         
                        for (var x = 0; x < models.length; x++) {
                            models[x].userData.layerId = j;
                            models[x].userData.featureId = x;
                            models[x].userData.type = "layer";
                        }
                        plane.layers[j].model = models;
                        plane.layers[j].block = blocks;
                            }
                        }
                    }
                });
            }

            if (app.project.plane[i] != undefined) {
                var mesh = app.project.plane[i].mesh;
                app.project.plane[i] = plane;
                app.project.plane[i].mesh = mesh;
            } else {
                app.project.plane[i] = plane;
            }

        });

        geoList.forEach(function (geo) {
            app.getGeoJson(geo.i, geo.url);
        });

        app.octree.update();
        app.octreeNeedsUpdate = true;
        app.wmsready = true;
        app.queryObjNeedsUpdate = true;
        app.queryableObjects();
        app.frustum = new THREE.Frustum();
    };

    app.addEventListeners = function () {
        window.addEventListener("keydown", app.eventListener.keydown);
        window.addEventListener("resize", app.eventListener.resize);

        //mouseEvent
        window.addEventListener("mousemove", app.eventListener.onMouseMove, false);

        var e = Q3D.$("closebtn");
        if (e) e.addEventListener("click", app.closePopup);
    };

    app.eventListener = {
        keydown: function (e) {
            if (e.ctrlKey || e.altKey) return;
            var keyPressed = e.which;
            if (!e.shiftKey) {
                if (keyPressed == 27) app.closePopup(); // ESC
                else if (keyPressed == 73) app.showInfo();  // I
                else if (keyPressed == 87) app.setWireframeMode(!app._wireframeMode);    // W
            }
            else {
                if (keyPressed == 82) app.controls.reset();   // Shift + R
                else if (keyPressed == 83) app.showPrintDialog();    // Shift + S
            }
        },

        resize: function () {
            if (app._fullWindow) app.setCanvasSize(window.innerWidth, window.innerHeight);
        },

        onMouseMove: function () {
            app.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            app.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        }

    };

    app.setCanvasSize = function (width, height) {
        app.width = width;
        app.height = height;
        app.camera.aspect = width / height;
        app.camera.updateProjectionMatrix();
        app.renderer.setSize(width, height);
    };

    app.buildDefaultLights = function (parent) {
        var deg2rad = Math.PI / 180;

        // ambient light
        //parent.add(new THREE.AmbientLight(0x111111));

        // directional lights
        var opt = Q3D.Options.light.directional;
        var lambda = (90 - opt.azimuth) * deg2rad;
        var phi = opt.altitude * deg2rad;

        var x = Math.cos(phi) * Math.cos(lambda),
            y = Math.cos(phi) * Math.sin(lambda),
            z = Math.sin(phi);

        var light1 = new THREE.DirectionalLight(0xffffff, 0.8);
        light1.position.set(0, 100, 500);

        parent.add(light1);

        // thin light from the opposite direction
        var light2 = new THREE.DirectionalLight(0xffffff, 0.1);
        light2.position.set(-x, -y, -z);

        light2.castShadow = true;
        light2.shadowDarkness = 0.5;
        light2.shadowCameraVisible = true;
        parent.add(light2);
    };

    app.buildDefaultCamera = function () {
        app.camera = new THREE.PerspectiveCamera(45, app.width / app.height, 0.1, 1000);


        var position = { x: 0, y: 0, z: 150 };
        var target = { x: 45, y: 15, z: 10 };
        var tween = new TWEEN.Tween(position).to(target, 2000);

        tween.easing(TWEEN.Easing.Exponential.InOut);
        tween.onUpdate(function () {
            //loadedMesh.position.x = position.x;
            app.camera.position.set(position.x, position.y, position.z);
            app.camera.lookAt(new THREE.Vector3(0, 0, 0));

        });
        tween.start();

    };

    app.currentViewUrl = function () {
        var c = app.camera.position, t = app.controls.target, u = app.camera.up;
        var hash = "#cx=" + c.x + "&cy=" + c.y + "&cz=" + c.z;
        if (t.x || t.y || t.z) hash += "&tx=" + t.x + "&ty=" + t.y + "&tz=" + t.z;
        if (u.x || u.y || u.z != 1) hash += "&ux=" + u.x + "&uy=" + u.y + "&uz=" + u.z;
        return window.location.href.split("#")[0] + hash;
    };

    // start rendering loop
    app.start = function () {
        app.running = true;
        if (app.controls) app.controls.enabled = true;
        app.animate();
    };

    app.pause = function () {
        app.running = false;
        if (app.controls) app.controls.enabled = false;
    };

    // animation loop
    app.animate = function () {
        app.stats.begin();

        //Set the raycaster vector to originate from the camera with direction onto the mouse position
        app.raycaster.setFromCamera(app.mouse, app.camera);

        //If we changed the active octree update
        if (app.octreeNeedsUpdate) {
            
            app.octree.update();
            app.octreeObjects = app.octree.search(app.raycaster.ray.origin, 20, true, app.vector);
            app.octree.update();
           
        }
        //If the camera lookat has changed, search the octree
        var vector = new THREE.Vector3(0, 0, -1);
        vector.applyQuaternion(app.camera.quaternion);
        if (app.vector == undefined) {
            app.vector = vector;
        }
        if (app.lastposition == undefined) {
            //Take a deepcopy of the last position
            app.lastposition = $.extend(true, {}, app.camera.position);
        }

        if ((app.wmsready && ((vector.x != app.vector.x && vector.y != app.vector.y && vector.z != app.vector.z) || app.lastposition.x != app.camera.position.x)) || app.octreeNeedsUpdate) {
            app.vector = vector; //Re-assign the current camera position
            app.lastposition = $.extend(true, {}, app.camera.position); //Take a new deep copy
            app.octreeObjects = app.octree.search(app.raycaster.ray.origin, 100, true, app.vector);

            if (app.octreeObjects.length > 0) {
                //remove buildings before update
                app.project.plane.forEach(function (plane) {
                    if (plane.buildings !== undefined) {
                        plane.buildings.model.forEach(function (child) {
                            if (child instanceof THREE.Mesh) {
                                app.scene.remove(child);
                                //app.octree.remove(child);
                            }
                        });
                    }


                });
                for (var i = 0; i < app.octreeObjects.length; i++) {
                    app.scene.add(app.octreeObjects[i].object);
                }
            }
        }
        app.octreeNeedsUpdate = false;

        TWEEN.update();
        app.render();
        app.stats.end();

        if (app.running) requestAnimationFrame(app.animate);
        if (app.controls) app.controls.update();
    };

    app.render = function () {
        app.renderer.render(app.scene, app.camera);

    };


    app.setWireframeMode = function (wireframe) {
        if (wireframe == app._wireframeMode) return;

        app.project.layers.forEach(function (layer) {
            layer.setWireframeMode(wireframe);
        });

        app._wireframeMode = wireframe;
    };

    app.queryableObjects = function () {
        if (app.queryObjNeedsUpdate) {
            app._queryableObjects = [];

            //Make the plane tiles queryable
            if (app.project.plane != undefined) {
                app.project.plane.forEach(function (plane) {
                    if (plane.buildings != undefined) {
                        plane.buildings.model.forEach(function (model) {
                            app._queryableObjects = app._queryableObjects.concat(model);
                        });
                    }
                    if (plane.layers != undefined) {

                        plane.layers.forEach(function (layer) {
                            if (layer.model != undefined) {
                                layer.model.forEach(function (model) {
                                    app._queryableObjects = app._queryableObjects.concat(model);
                                });
                            }

                        });
                    }

                    app._queryableObjects = app._queryableObjects.concat(plane.mesh);

                });
            }
        }
        app.queryObjNeedsUpdate = false;
        return app._queryableObjects;
    };

    app.intersectObjects = function (offsetX, offsetY) {

        var x = (offsetX / app.width) * 2 - 1;
        var y = -(offsetY / app.height) * 2 + 1;
        var vector = new THREE.Vector3(x, y, 1);
        vector.unproject(app.camera);
        var ray = new THREE.Raycaster(app.camera.position, vector.sub(app.camera.position).normalize());

        return ray.intersectObjects(app.queryableObjects());

    };

    app._offset = function (elm) {
        var top = 0, left = 0;
        do {
            top += elm.offsetTop || 0; left += elm.offsetLeft || 0; elm = elm.offsetParent;
        } while (elm);
        return { top: top, left: left };
    };

    app.help = function () {
        var lines = (Q3D.Controls === undefined) ? [] : Q3D.Controls.keyList;
        if (lines.indexOf("* Keys") == -1) lines.push("* Keys");
        lines = lines.concat([
          "I : Show Information About Page",
          "W : Wireframe Mode",
          "Shift + R : Reset View",
          "Shift + S : Save Image"
        ]);
        var html = '<table>';
        lines.forEach(function (line) {
            if (line.trim() == "") return;

            if (line[0] == "*") {
                html += '<tr><td colspan="2" class="star">' + line.substr(1).trim() + "</td></tr>";
            }
            else if (line.indexOf(":") == -1) {
                html += '<tr><td colspan="2">' + line.trim() + "</td></tr>";
            }
            else {
                var p = line.split(":");
                html += "<tr><td>" + p[0].trim() + "</td><td>" + p[1].trim() + "</td></tr>";
            }
        });
        html += "</table>";
        return html;
    };

    app.popup = {

        modal: false,

        // show box
        // obj: html or element
        show: function (obj, title, modal) {

            if (modal) app.pause();
            else if (this.modal) app.start();   // enable controls

            this.modal = Boolean(modal);

            var content = Q3D.$("popupcontent");
            if (obj === undefined) {
                // show page info
                content.style.display = "none";
                Q3D.$("pageinfo").style.display = "block";
            }
            else {
                Q3D.$("pageinfo").style.display = "none";
                if (obj instanceof HTMLElement) {
                    content.innerHTML = "";
                    content.appendChild(obj);
                }
                else {
                    content.innerHTML = obj;
                }
                content.style.display = "block";
            }
            Q3D.$("popupbar").innerHTML = title || "";
            Q3D.$("popup").style.display = "block";
        },

        hide: function () {
            Q3D.$("popup").style.display = "none";
            if (this.modal) app.start();    // enable controls
        }

    };

    app.showInfo = function () {
        Q3D.$("urlbox").value = app.currentViewUrl();
        Q3D.$("usage").innerHTML = app.help();
        app.popup.show();
    };

    app.showQueryResult = function (point, layerId, featureId, type, planeId) {
        var layer, r = [];

        if (layerId !== undefined) {
            //If layerId is WFS - Nicolai
            if (layerId == 100 || layerId == 110) {
                layer = app.project.layers[0];
                r.push('<table class="layer">');
                r.push("<caption>Layer name</caption>");
                r.push("<tr><td>" + layer.type + "</td></tr>");
                r.push("</table>");

            } else if (type == "layer") {
                // layer name
                //TODO: create userData to figure out WHAT layer it is on WHAT tile (layerId is not sufficient)
                layer = app.project.plane[planeId].layers[layerId];
                r.push('<table class="layer">');
                r.push("<caption>Layer name</caption>");
                r.push("<tr><td>" + layer.name + "</td></tr>");
                r.push("</table>");
            } else if (type == "building") {
                console.log("Clicked object is of type building");
                layer = app.project.plane[layerId];
                r.push('<table class="layer">');
                r.push("<caption>Layer name</caption>");
                r.push("<tr><td>" + "Building" + "</td></tr>");
                r.push("</table>");
            }

        }


        // clicked coordinates
        var pt = app.project.toMapCoordinates(point.x, point.y, point.z);

        r.push('<table class="coords">');
        r.push("<caption>Clicked coordinates</caption>");
        r.push("<tr><td>");

        if (typeof proj4 === "undefined") r.push([pt.x.toFixed(2), pt.y.toFixed(2), pt.z.toFixed(2)].join(", "));
        else {
            var lonLat = proj4(app.project.proj).inverse([pt.x, pt.y]);
            r.push(Q3D.Utils.convertToDMS(lonLat[1], lonLat[0]) + ", Elev. " + pt.z.toFixed(2));

        }
        //app.getList(pt.x.toFixed(2), pt.y.toFixed(2));

        r.push("</td></tr></table>");
        if (type == "building") {
            layer.a = layer.buildings.a;
        }
        if (layerId !== undefined && featureId !== undefined && layer.a !== undefined) {
            // attributes
            r.push('<table class="attrs">');
            r.push("<caption>Attributes</caption>");
          
            var prop = [];

            for (var proper in layer.a[0]) {
                prop.push(proper);
            }
            for (var prop in layer.a[featureId]) {
                if (layer.a[featureId].hasOwnProperty(prop)) {
                    if (String(prop) != "Polygon" && String(prop) != "geometri" && String(prop) != "outerBoundaryIs" && String(prop) != "LinearRing" && String(prop) != "coordinates") {

                        r.push("<tr><td>" + prop + "</td><td>" + layer.a[featureId][prop] + "</td></tr>");
                    }
                }
            }
        }
        r.push('<table class="attrs">');
        r.push("<caption>User Data</caption>");
        if (type == "building") {
            layer.buildings.model.forEach(function (model, i) {
                if (model.userData.uData != undefined && i == featureId) {
                    for (var prop in model.userData.uData) {
                        r.push("<tr><td>" + prop + "</td><td>" + model.userData.uData[prop] + "</td></tr>");
                    }

                }
            });
        }

        app.popup.show(r.join(""));
    };

    app.showPrintDialog = function () {

        function e(tagName, parent, innerHTML) {
            var elem = document.createElement(tagName);
            if (parent) parent.appendChild(elem);
            if (innerHTML) elem.innerHTML = innerHTML;
            return elem;
        }

        var f = e("form");
        f.className = "print";

        var d1 = e("div", f, "Image Size");
        d1.style.textDecoration = "underline";

        var d2 = e("div", f),
            l1 = e("label", d2, "Width:"),
            width = e("input", d2);
        d2.style.cssFloat = "left";
        l1.htmlFor = width.id = width.name = "printwidth";
        width.type = "text";
        width.value = app.width;
        e("span", d2, "px,")

        var d3 = e("div", f),
            l2 = e("label", d3, "Height:"),
            height = e("input", d3);
        l2.htmlFor = height.id = height.name = "printheight";
        height.type = "text";
        height.value = app.height;
        e("span", d3, "px");

        var d4 = e("div", f),
            ka = e("input", d4);
        ka.type = "checkbox";
        ka.checked = true;
        e("span", d4, "Keep Aspect Ratio");

        var d5 = e("div", f, "Option");
        d5.style.textDecoration = "underline";

        var d6 = e("div", f),
            bg = e("input", d6);
        bg.type = "checkbox";
        bg.checked = true;
        e("span", d6, "Fill Background");

        var d7 = e("div", f),
            ok = e("span", d7, "OK"),
            cancel = e("span", d7, "Cancel");
        d7.className = "buttonbox";

        e("input", f).type = "submit";

        // event handlers
        // width and height boxes
        var aspect = app.width / app.height;

        width.oninput = function () {
            if (ka.checked) height.value = Math.round(width.value / aspect);
        };

        height.oninput = function () {
            if (ka.checked) width.value = Math.round(height.value * aspect);
        };

        ok.onclick = function () {
            app.popup.show("Rendering...");
            window.setTimeout(function () {
                app.saveCanvasImage(width.value, height.value, bg.checked);
            }, 10);
        };

        cancel.onclick = app.closePopup;

        // enter key pressed
        f.onsubmit = function () {
            ok.onclick();
            return false;
        }

        app.popup.show(f, "Save Image", true);   // modal
    };

    app.closePopup = function () {
        app.popup.hide();
        app.queryMarker.visible = false;
        // app.highlightFeature(null, null);
        if (app._canvasImageUrl) {
            URL.revokeObjectURL(app._canvasImageUrl);
            app._canvasImageUrl = null;
        }
    };

    app.highlightFeature = function (layerId, featureId, type, planeId) {

        if (app.highlightObject) {
            // remove highlight object from the scene
            app.scene.remove(app.highlightObject);
            app.selectedLayerId = null;
            app.selectedFeatureId = null;
            app.highlightObject = null;
        }

        /*
        Nicolai: Menu for the selected feature. Remove the folder id no object is selected
        */
        if (Q3D.gui.gui.__folders["Selected Feature"] == undefined) {
            var folder = Q3D.gui.gui.addFolder("Selected Feature");
            folder.open();
        } else {
            var folder = Q3D.gui.gui.__folders["Selected Feature"];
            Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
            delete Q3D.gui.gui.__folders["Selected Feature"];

            if (layerId != null && featureId != null) {
                var folder = Q3D.gui.gui.addFolder("Selected Feature");
                folder.open();
            }
        }


        if (layerId === null || featureId === null) return;

        if (type == "layer") {
            var layer = app.project.plane[planeId].layers[layerId];
            if (layer.spectrumData != undefined) {
                initSpectrum(layer.maxmin[layer.spectrumData], "GeoJSON", layer.spectrumData);
            }

        } else if (type == "building") {
            var layer = app.project.plane[layerId].buildings;
            if (app.project.plane[layerId].spectrumData != undefined) {
                initSpectrum(layer.maxmin[app.project.plane[layerId].spectrumData], "Building", app.project.plane[layerId].spectrumData);
            }

        }

        if (layer === undefined) return;
        if (["Icon", "JSON model", "COLLADA model"].indexOf(layer.objType) != -1) return;



        var model = layer.model[featureId];

        folder.addColor(Q3D.gui.parameters, 'color').name('Color selected').onChange(function (color) {
            var pColor = color.replace('#', '0x');
            model.material.color.setHex(pColor);
        });

        folder.addColor(Q3D.gui.parameters, 'color').name('Color Layer').onChange(function (color) {

            var pColor = color.replace('#', '0x');
            for (var i = 0; i < layer.model.length; i++) {
                layer.model[i].material.color.setHex(pColor);
                if (type == "building") {
                    // layer.mergeMesh.material.color.setHex(pColor);
                }
            }
        });
        if (type == "layer") {
            folder.add(Q3D.gui.parameters, 'resolution').name('Visualize GeoJSON').onChange(function () {
                initVizMenu(layer.maxmin);

                /* TODO method that resets the viz back to the original configuration
                */
                startViz(function (colour_data, height_data, vizComplete) {

                    var doColour = (colour_data != 'default');
                    var doHeight = (height_data != 'default');
                    var colour_method = 'none';
                    var height_method = 'none';

                    if (doColour) {
                        colour_method = (document.getElementById('c_building').checked) ? 'building' :
                            (document.getElementById('c_block').checked) ? 'block' : 'none';

                        initSpectrum(layer.maxmin[colour_data], "GeoJSON", colour_data);
                        layer.spectrumData = colour_data;
                    }
                    if (doHeight) {
                        height_method = (document.getElementById('h_building').checked) ? 'building' :
                            (document.getElementById('h_block').checked) ? 'block' : 'none';
                    }

                    //Spectrum image for turning normalized data to a color
                    var img = document.getElementById('spectrum');
                    var canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, img.width, img.height);


                    var maxminlist = layer.maxmin;

                    //Reset the block list upon new visualization
                    if (layer.block != undefined) {
                        layer.block.forEach(function (block) {
                            app.scene.remove(block);
                        });
                        delete layer.block;
                    }

                    //Reset the viz 
                    layer.model.forEach(function (model, i) {
                        var color = 0xffffff;
                        var material = new THREE.MeshLambertMaterial({
                            color: color,
                            polygonOffset: true,
                            polygonOffsetFactor: 0.2,
                            polygonOffsetUnits: 1.0
                        });

                        model.scale.set(1, 1, 1);
                        model.material = material;
                    });

                    layer.model.forEach(function (model, i) {
                        if (doColour) {
                            var x = layer.a[i][colour_data];
                            if (x != undefined) {

                                //Calculate normalized value [0; 1]
                                var x_max = maxminlist[colour_data].max;
                                var x_min = maxminlist[colour_data].min;
                                var x_norm = (x - x_min) / (x_max - x_min);
                                var x_img = (x_norm * (canvas.width - 1)) | 0;

                                var colour = {};
                                if (!isNaN(x_img)) {
                                    colour = ctx.getImageData(x_img, 5, 1, 1);
                                } else {
                                    colour.data = [0, 0, 0];
                                }

                                if (colour_method == 'building') {
                                    // Translate normalized value to RGB
                                    var color = 0xffffff;
                                    var material = new THREE.MeshLambertMaterial({
                                        color: color,
                                        polygonOffset: true,
                                        polygonOffsetFactor: 0.2,
                                        polygonOffsetUnits: 1.0
                                    });

                                    model.material = material;
                                    model.material.color.setRGB(colour.data[0] / 255, colour.data[1] / 255, colour.data[2] / 255);

                                } else if (colour_method == 'block') {
                                    if (layer.block == undefined) {
                                        layer.block = [];
                                    }
                                    var color = 0xffffff;
                                    var material = new THREE.MeshLambertMaterial({
                                        color: color,
                                        polygonOffset: true,
                                        polygonOffsetFactor: 0.2,
                                        polygonOffsetUnits: 1.0
                                    });

                                    var geometry = new THREE.BoxGeometry(1, 1, 1);
                                    var cube = new THREE.Mesh(geometry, material);

                                    //Compute the buildings bounding box so we can get the center point
                                    //If the model is just a block, we get the same block
                                    model.geometry.computeBoundingBox();

                                    var boundingBox = model.geometry.boundingBox;

                                    var position = new THREE.Vector3();
                                    position.subVectors(boundingBox.max, boundingBox.min);
                                    position.multiplyScalar(0.5);
                                    position.add(boundingBox.min);

                                    position.applyMatrix4(model.matrixWorld);
                                    cube.material = material;
                                    //Divide by 255 as setRGB takes values between 0 - 1
                                    cube.material.color.setRGB(colour.data[0] / 255, colour.data[1] / 255, colour.data[2] / 255);

                                    cube.position.set(position.x, position.y, 1);
                                    app.scene.add(cube);
                                    layer.block.push(cube);
                                }
                            }
                        }
                        if (doHeight) {
                            var x = layer.a[i][height_data];
                            if (x != undefined) {
                                var x_max = maxminlist[height_data].max;
                                var x_min = maxminlist[height_data].min;
                                var x_norm = (x - x_min) / (x_max - x_min);

                                //These values are magicnumbers, but defines how extreme values are depicted
                                var max_height = 20;
                                var min_height = 2;
                                var x_height = min_height + (max_height - min_height) * x_norm;

                                if (height_method == 'building') {
                                    // Translate normalized value to height
                                    model.scale.set(1, 1, x_height);
                                } else if (height_method == 'block') {
                                    if (layer.block == undefined) {
                                        layer.block = [];
                                    }

                                    //If we dident already use blocks for the previous method
                                    if (cube == undefined) {
                                        var color = 0xffffff;
                                        var material = new THREE.MeshLambertMaterial({
                                            color: color,
                                            polygonOffset: true,
                                            polygonOffsetFactor: 0.2,
                                            polygonOffsetUnits: 1.0
                                        });

                                        var geometry = new THREE.BoxGeometry(1, 1, 1);
                                        var cube = new THREE.Mesh(geometry, material);

                                        model.geometry.computeBoundingBox();

                                        var boundingBox = model.geometry.boundingBox;

                                        var position = new THREE.Vector3();
                                        position.subVectors(boundingBox.max, boundingBox.min);
                                        position.multiplyScalar(0.5);
                                        position.add(boundingBox.min);

                                        position.applyMatrix4(model.matrixWorld);
                                        cube.position.set(position.x, position.y, 1);
                                        cube.scale.set(1, 1, x_height);
                                        cube.translateZ(x_height / 2);

                                        app.scene.add(cube);
                                        layer.block.push(cube);
                                    } else { //If we already created a block, we dont create it twice, we just change its height
                                        cube.scale.set(1, 1, x_height);
                                        cube.translateZ(x_height / 2);
                                    }


                                } // Add other methods of height viz here
                            }

                        } // Add other visiualization techniques here (Opacity? Sprites above buildings?)
                    });
                    var plane = app.project.plane[planeId];
                    var detail = plane.detail;
                    detail.layers[layerId].viz = true;
                    vizComplete();
                });

            });

        }

        folder.add(Q3D.gui.parameters, 'height').min(1).max(5).name('Height').onChange(function (height) {
            model.scale.set(model.scale.x, model.scale.y, height);
        });

        if (type == "layer") {
            folder.add(Q3D.gui.parameters, 'resolution').name('Delete').onChange(function () {
                layer.model.forEach(function (model, i) {
                    app.scene.remove(model);
                    app.octree.remove(model);
                    model = null;
                    if (layer.block != undefined) {
                        if (layer.block[i] != undefined) {
                            app.scene.remove(layer.block[i]);
                            app.octree.remove(layer.block[i]);
                            layer.block[i] = null;
                        }
                    }

                });

                app.project.plane[planeId].layers[layerId] = [];
                app.project.plane[planeId].detail.layers[layerId] = [];

                app.queryObjNeedsUpdate = true;
                app.queryableObjects();
            });

        }

        var high_mat = app.highlightMaterial;
        var setMaterial = function (obj) {
            obj.material = high_mat;
        };

        var clone = model.clone();
        clone.material = high_mat;
        var s = 1.0;

        //Calculates the position of the cloned object in world coordinates
        clone.geometry.computeBoundingBox();
        var boundingBox = clone.geometry.boundingBox;

        var position = new THREE.Vector3();
        position.subVectors(boundingBox.max, boundingBox.min);
        position.multiplyScalar(0.5);
        position.add(boundingBox.min);
        //clone.userData.layerId = null;
        position.applyMatrix4(clone.matrixWorld);
        clone.scale.set(clone.scale.x * s, clone.scale.y * s, clone.scale.z * s);
        var highlightObject = clone;

        app.scene.add(highlightObject);
        app.scene.updateMatrixWorld(true);

        app.selectedLayerId = layerId;
        app.selectedFeatureId = featureId;
        app.highlightObject = highlightObject;
    };

    app.buildBuildings = function (response, plane, xmin, ymin, xmax, ymax, row, column, url, showBuildings,callback) {
        row = row * 2 + 1;
        column = column * 2 + 1;
        app.wmsready = false;
        app.loader = new THREE.ObjectLoader();


        var coordinates = response.getElementsByTagName("coordinates");
        var attributes = response.getElementsByTagName("Bygning");

        //WebWorker to reduce stress on main thread
        var myWorker1 = new Worker('../3D/scripts/gml_worker.js');
        /*
        Worker version of script
        Input: GML response
        */
        var count = 1;

        if (coordinates.length > 0) {

            plane.buildings = {};
            plane.buildings.model = [];
            plane.buildings.a = [];
            plane.buildings.name = "FOT10";
            plane.buildings.modelJSON = [];

            var loader = new THREE.JSONLoader();
            var widthP = app.project.width;
            var heightP = app.project.height;

            var widthM = xmax - xmin;
            var heightM = ymax - ymin;

            var factorX = (widthP / widthM);
            var factorY = (heightP / heightM);

            for (var i = 0; i < coordinates.length; i++) {
                //For every collection of coordinates, we have to convert them to threejs points
                var gmlPoints = new XMLSerializer().serializeToString(coordinates[i].childNodes[0]);
                var cords = gmlPoints.split(" ");

                if (attributes[i] != undefined) {
                    var gmlAttributes = attributes[i].getElementsByTagName("*");
                    plane.buildings.a[i] = {};
                    for (var k = 0; k < gmlAttributes.length; k++) {
                        var key = String(gmlAttributes[k].nodeName);
                        var key = key.replace(/kms:|gml:/gi, "");
                        var value = gmlAttributes[k].innerHTML;
                        plane.buildings.a[i][key] = value;
                    }
                }

                myWorker1.postMessage([app.project.zScale, app.project.layers.length, i, cords, widthP, heightP, column, row, xmax, ymax, factorX, factorY]);

                myWorker1.onmessage = function (e) {
                    var loadedGeometry = JSON.parse(e.data[0]);

                    var mesh = app.loader.parse(loadedGeometry);

                    mesh.mapcoords = [e.data[2], e.data[3]];
                    mesh.userData = {};
                    mesh.userData.layerId = plane.mesh.userData.index;
                    mesh.userData.featureId = e.data[1];
                    mesh.userData.type = "building";

                    plane.buildings.model[e.data[1]] = mesh;

                    if (showBuildings == true) {
                        app.octree.add(mesh);
                        var opacity = 0.3;
                    } else {
                        var opacity = 1;
                    }

                    if (count >= coordinates.length) {

                        plane.buildings.url = url;
                        plane.buildings.name = name;
                        plane.buildings.type = "GML";

                        //Merge the buildings into one layer to save drawcalls improving FPS
                        app.mergeBuilding(plane, 1);


                        app.queryObjNeedsUpdate = true;
                        app.queryableObjects();
                        callback();

                    }
                    count++;
                }
            }
        }
    };

    app.getBuildings = function (plane, xmin, ymin, xmax, ymax, row, column, url, showBuildings, callback) {
      
        var bbox = "&Bbox=" + xmin + "," + ymin + "," + xmax + "," + ymax;

       
        url = url + bbox;
       
        $.ajax({
            url: url,
            dataType: "xml",
        })
       .success(function (response) {

           app.buildBuildings(response,plane, xmin,ymin,xmax,ymax,row,column,url,showBuildings,callback);

       })
     .fail(function (jqXHR, textStatus, errorThrown) {
         alert("Failed Query");
     });

    }

    app.mergeBuilding = function (plane, opacity) {

        var mergeGeometry = new THREE.Geometry();

        for (var i = 0; i < plane.buildings.model.length; i++) {
            plane.buildings.model[i].updateMatrix();
            var geometry = plane.buildings.model[i].geometry;
            var matrix = plane.buildings.model[i].matrix;

            mergeGeometry.merge(geometry, matrix, i);
           
        }


        mergeGeometry.dynamic = true;

        var material = new THREE.MeshPhongMaterial({
            opacity: opacity, transparent: true, color: 0xffffff, polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 0.1
        });
        var mesh = new THREE.Mesh(mergeGeometry, material);
        mesh.scale.set(1, 1, 0.95);
        plane.mergeMesh = mesh;
        plane.buildings.mergeMesh = mesh;

        var position = { x: 0, y: -2 };
        var target = { x: 0, y: 0 };
        var tween = new TWEEN.Tween(position).to(target, 3000);

        tween.onUpdate(function () {
            //loadedMesh.position.x = position.x;
            mesh.position.z = position.y;
        });
        tween.onComplete(function () {

            app.wmsready = true;
            app.queryObjNeedsUpdate = true;
            app.queryableObjects();
        });
        app.octree.add(mesh);

        app.octreeNeedsUpdate = true;
     
        tween.start();
    }
    /*
    Merges a layer into one geometry for performance gain
    Adds the mergedGeometry as a representation mesh of that layer
    Adds the mergedGeometry to the octree
    */
    app.mergeLayer = function (layer, opacity) {

        var mergeGeometry = new THREE.Geometry();

        for (var i = 0; i < layer.model.length; i++) {
            layer.model[i].updateMatrix();
            var geometry = layer.model[i].geometry;
            var matrix = layer.model[i].matrix;

            mergeGeometry.merge(geometry, matrix, i);
            //app.project.WFSlayers[0].model.geometry
        }


        mergeGeometry.dynamic = true;

        var material = new THREE.MeshPhongMaterial({
            opacity: opacity, transparent: true, color: 0xffffff, polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 0.1
        });
        var mesh = new THREE.Mesh(mergeGeometry, material);
        mesh.scale.set(1, 1, 0.95);
        layer.mergeMesh = mesh;


        var position = { x: 0, y: -2 };
        var target = { x: 0, y: 0 };
        var tween = new TWEEN.Tween(position).to(target, 3000);

        tween.onUpdate(function () {
            //loadedMesh.position.x = position.x;
            mesh.position.z = position.y;
        });
        tween.onComplete(function () {

            app.wmsready = true;

        });
        app.octree.add(mesh);
        app.octreeNeedsUpdate = true;
        app.date2 = new Date();

        tween.start();
    }
    /*
    Terrain Test Function
    Not used
    */
    app.generateTerrain = function (url, height, width) {

        var img = new Image();
        var canvas = document.createElement('canvas');
        canvas.width = width - 1;
        canvas.height = height - 1;
        var context = canvas.getContext('2d');
        var data = new Float32Array(0);



        img.onload = function () {

            var width = 2;
            var height = 2;
            // var url = "http://kortforsyningen.kms.dk/service?servicename=orto_sommer_2010&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=orto_sommer_2010&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
            var url = "http://kortforsyningen.kms.dk/service?servicename=topo_geo&client=QGIS&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=bygning&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
            // var url = "http://kortforsyningen.kms.dk/service?servicename=adm_500_2008_r&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=KOM500_2008&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
            // var url = "http://kortforsyningen.kms.dk/service?servicename=topo4cm_1953_1976&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016!&layers=dtk_4cm_1953_1976&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";

            img.height = height;
            img.width = width;
            for (var i = 0; i < size; i++) {
                data[i] = 0
            }

            var imgd = context.getImageData(0, 0, width, height);
            var pix = imgd.data;

            var j = 0;
            for (var i = 0; i < pix.length; i += 4) {
                var all = pix[i] + pix[i + 1] + pix[i + 2];
                data[j++] = all / 24;
            }

            var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height, width - 1, height - 1);
            var texture = THREE.ImageUtils.loadTexture(url);
            var material = new THREE.MeshLambertMaterial({ map: texture });

            var plane = new THREE.Mesh(geometry, material);

            //set height of vertices
            for (var i = 0; i < plane.geometry.vertices.length; i++) {
                plane.geometry.vertices[i].z = data[i];
            }
            geometry.verticesNeedUpdate = true;
            app.project.layers[0].setVisible(false);
            app.project.plane = [];
            app.project.plane[0] = plane;
            app.scene.add(app.project.plane[0]);
        }
        img.src = url;
        img.crossOrigin = "Anonymous";

    }

    app.calculatebbox = function (num) {

        THREE.ImageUtils.crossOrigin = ""; //Allows us to avoid CORS problems for textures
        //Gets the extent of the project plane
        var xmin = parseFloat(app.project.baseExtent[0]);
        var ymin = parseFloat(app.project.baseExtent[1]);
        var xmax = parseFloat(app.project.baseExtent[2]);
        var ymax = parseFloat(app.project.baseExtent[3]);

        //The length of a tile in spatial reference notation
        var tilex = parseFloat((xmax - xmin) / num);
        var tiley = parseFloat((ymax - ymin) / num);

        //Tile pixel dimensions (Higher is more detailed)
        var width = 512;
        var height = 512;

        //The service URL for the layer we are using for map (Here orto photos from kortforsyningen)
        var url = "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&width=" + (width) + "&height=" + (height) + "&format=image%2Fpng&srs=EPSG%3A25832";
        // var url = "http://kortforsyningen.kms.dk/service?servicename=topo_skaermkort&client=QGIS&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=dtk_skaermkort_07&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
        var materials = []; //Array to hold our tiled images
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = true;

        //Create the proper materials, we dont care to wait until they are loaded
        for (var column = num - 1; column >= 0; column--) {
            for (var row = 0; row < num; row++) {
                THREE.ImageUtils.crossOrigin = '';
                var texture = THREE.ImageUtils.loadTexture(url + "&bbox=" + (xmin + (row * tilex) + 2) + "," + (ymin + (column * tiley) - 2) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley)));
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.x = num;
                texture.repeat.y = num;

                var material = new THREE.MeshPhongMaterial({ map: texture });
                material.url = url + "&bbox=" + (xmin + (row * tilex)) + "," + (ymin + (column * tiley)) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley));
                material.bbox = "&bbox=" + (xmin + (row * tilex)) + "," + (ymin + (column * tiley)) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley));
                materials.push(material);
            }
        }

        var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height, num, num);
        geometry.materials = materials;

        var l = geometry.faces.length / 2; // divided by 2 because each tile consists two triangles, which is two faces.

        //Figure out how faces are assigned, is it per row or per column?
        for (var i = 0; i < l; i++) {
            //Make sure we texture in pairs (Dont want triangle tiles)
            var j = i * 2
            geometry.faces[j].materialIndex = i % materials.length;
            geometry.faces[j + 1].materialIndex = i % materials.length;
        }

        var plane = new THREE.Mesh(geometry, material);
        plane.position.z = 0;

        app.project.plane = [];
        plane.userData.index = 0;
        var planeObject = { mesh: plane, detail: { buildings: 0, address: false, style: "block", resolution: false } };

        app.clonePlane = planeObject;
        app.octree.update();


    }

    app.extendMap = function (dim, planeData) {
        var num = 1;

        var xmin = parseFloat(app.project.baseExtent[0]);
        var ymin = parseFloat(app.project.baseExtent[1]);
        var xmax = parseFloat(app.project.baseExtent[2]);
        var ymax = parseFloat(app.project.baseExtent[3]);

        //The length of a tile in spatial reference notation
        var tilex = parseFloat((xmax - xmin) / num);
        var tiley = parseFloat((ymax - ymin) / num);

        //Tile pixel dimensions (Higher is more detailed)
        var width = 256;
        var height = 256;
        var url = app.project.map.url + "&width=" + width + "&height=" + height;
        var materials = [];


        //The service URL for the layer we are using for map (Here orto photos from kortforsyningen)
        // var url = "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&width=" + (width) + "&height=" + (height) + "&format=image%2Fpng&srs=EPSG%3A25832";
        var buildingUrl = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";
        var index = 0;
        for (var column = -dim; column <= dim; column++) {
            for (var row = -dim; row <= dim; row++) {

                var tempPlane = app.clonePlane.mesh.clone();
                tempPlane.visible = true;

                THREE.ImageUtils.crossOrigin = '';
                var texture = THREE.ImageUtils.loadTexture(url + "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley)));
                var material = new THREE.MeshPhongMaterial({ map: texture })
                material.url = url + "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley));
                material.bbox = "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley));


                tempPlane.material = material;
                tempPlane.position.x = app.project.width * column;
                tempPlane.position.y = app.project.height * row;

                app.scene.add(tempPlane);
                tempPlane.column = column;
                tempPlane.row = row;

                //Information to build buildings on the tile:


                tempPlane.userData.url = buildingUrl;
                tempPlane.userData.xmin = (xmin + (column * tilex));
                tempPlane.userData.ymin = (ymin + (row * tiley));
                tempPlane.userData.xmax = (xmin + ((column + 1) * tilex));
                tempPlane.userData.ymax = (ymin + ((row + 1) * tiley));
                tempPlane.userData.row = row;
                tempPlane.userData.column = column;
                tempPlane.userData.index = app.project.plane.length;

                //  var planeData = { tileWidth: (Math.sqrt((app.project.plane.length - 1)) - 1) / 2, planes: [{ detail: {}, buildings: {} }]};
                if (planeData != undefined) {
                    if (planeData.planes[index].detail.address == true) {

                    }
                    planeData.planes[index].detail.url = material.url;
                    planeData.planes[index].detail.bbox = material.bbox;
                    var planeObject = { mesh: tempPlane, detail: planeData.planes[index].detail };

                    //If we need to build the buildings, do it
                    if (planeObject.detail.buildings > 0 && planeObject.detail.address == false) {
                        if (planeObject.detail.buildings == 1) {
                            //Use a closure to store the planeobject in the current iteration
                            planeClosure(planeObject);
                            function planeClosure(planeObjectF) {
                                app.getBuildings(planeObjectF, tempPlane.userData.xmin, tempPlane.userData.ymin, tempPlane.userData.xmax, tempPlane.userData.ymax, tempPlane.userData.row, tempPlane.userData.column, tempPlane.userData.url, false,
                                  function () {
                                      //Add back the planeObject to the correct index in the finished callback
                                      //If the function fails, the plane will just be a normal empty plane
                                      app.project.plane[planeObjectF.mesh.userData.index] = planeObjectF;
                                  });
                            }

                        } else if (planeObject.detail.buildings == 2) {
                            //Do the same here but add buildings to the octree aswell
                            planeClosure(planeObject);
                            function planeClosure(planeObjectF) {
                                app.getBuildings(planeObjectF, tempPlane.userData.xmin, tempPlane.userData.ymin, tempPlane.userData.xmax, tempPlane.userData.ymax, tempPlane.userData.row, tempPlane.userData.column, tempPlane.userData.url, true,
                                  function () {
                                      app.project.plane[planeObjectF.mesh.userData.index] = planeObjectF;
                                  });
                            }
                        }
                    }

                } else {
                    var planeObject = { mesh: tempPlane, detail: { buildings: 0, address: false, style: "block", resolution: false, layers: [], url: material.url, bbox: material.bbox}};
                }

                app.project.plane.push(planeObject);
                index++;
            }
            app.queryObjNeedsUpdate = true;
            app.queryableObjects();
        }
    }
    app.updateResolution = function (plane,detail, num, width, height) {
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = true;
        var materials = [];
        var loaded = 0;
        if (plane.mesh != undefined) {
            plane = plane.mesh;
        }
        for (var i = 0; i < 1; i++) {
            //var temp = plane.material.materials[i];
            var temp = detail;
            var url = temp.url;

            var tempurl = "width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832&";
            url = url.replace(/width=.*&/, tempurl);

            
            THREE.ImageUtils.crossOrigin = '';
            var texture = THREE.ImageUtils.loadTexture(url);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.x = num;
            texture.repeat.y = num;

            var material = new THREE.MeshPhongMaterial({ map: texture });
            material.url = url;
            material.bbox = temp.bbox;
            materials.push(material);

            loader.load(url, function (texture) {
                
                plane.material = material;
                if (height <= 1024) {
                    app.updateResolution(plane, detail, num, width * 2, height * 2)

                }
            });
        }
    }

    app.removeLayer = function (id, removeoctree) {
        app.scene.children.forEach(function (child) {
            if (child.userData.layerId == id) {
                app.scene.remove(child);
                child = null;
            }
        });
        if (removeoctree) {
            for (var i = 0; i < app.project.layers.length; i++) {
                if (app.project.layers[i].model[0].userData.layerId == id) {
                    for (var j = 0; j < app.project.layers[i].model.length; j++) {
                        app.octree.remove(app.project.layers[i].model[j]);

                    }
                    app.octree.remove(app.project.layers[i].mergeMesh);
                }
            }
        }


        app.octreeNeedsUpdate = true;

    };
    /*
   Terrain Test Function
   Not used
   */
    app.wmsTerrain = function (num, width, height) {
        var url = "http://kortforsyningen.kms.dk/service?servicename=dhm&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=dtm_1_6m&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = true;

        //for (var i = 0; i < app.project.plane[0].material.materials.length; i++) {

        var temp = app.project.plane[0].material.materials[0];
        url = url + temp.bbox;
        //Get the height data from the terrain image
        var img = new Image();
        var canvas = document.createElement('canvas');
        canvas.width = width - 1;
        canvas.height = height - 1;
        var context = canvas.getContext('2d');
        var data = new Float32Array(0);
        img.onload = function () {

            var size = 0;
            context.drawImage(img, 0, 0);
            size = width * height;
            data = new Float32Array(size);

            img.height = height;
            img.width = width;
            for (var i = 0; i < size; i++) {
                data[i] = 0
            }

            var imgd = context.getImageData(0, 0, width, height);
            var pix = imgd.data;
            var j = 0;
            for (var i = 0; i < pix.length; i += 4) {
                var all = pix[i] + pix[i + 1] + pix[i + 2];
                data[j++] = all / 12;
            }

            // plane
            // var geometry = app.project.plane[0].geometry;
            var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height, width - 1, height - 1);

            var texture = THREE.ImageUtils.loadTexture(url);
            var material = new THREE.MeshLambertMaterial({ map: texture });

            //aterial.wireframe = true;
            var plane = new THREE.Mesh(geometry, material);
            //set height of vertices

            for (var i = 0; i < plane.geometry.vertices.length; i++) {
                plane.geometry.vertices[i].z = data[i];
            }
            geometry.verticesNeedUpdate = true;
            plane.setWireframeMode = true;
            app.project.plane[1] = plane;
            plane.position.set(1, 1, 1.5);

            return plane;
            // app.scene.add(plane);
        }
        img.src = url;
        img.crossOrigin = "Anonymous";


        //  }



    };

    app.makeTextSprite = function (message, fontsize) {
        var ctx, texture, sprite, spriteMaterial,
            canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d');
        ctx.font = fontsize + "px Arial";

        // setting canvas width/height before ctx draw, else canvas is empty
        canvas.width = ctx.measureText(message).width;
        canvas.height = fontsize * 2; // fontsize * 1.5

        // after setting the canvas width/height we have to re-set font to apply!?! looks like ctx reset
        ctx.font = fontsize + "px Arial";
        ctx.fillStyle = "rgba(255,0,0,1)";
        ctx.fillText(message, 0, fontsize);

        texture = new THREE.Texture(canvas);
        texture.minFilter = THREE.LinearFilter; // NearestFilter;
        texture.needsUpdate = true;

        spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        sprite = new THREE.Sprite(spriteMaterial);
        return sprite;
    };

    app.getList = function (xCor, yCor) {
        var d = new Date().getTime(); // for now

        var host = "http://dawa.aws.dk";
        var parametre = {};
        var srid = "";
        $.ajax({
            url: "http://dawa.aws.dk/adgangsadresser/reverse?x=" + xCor + "&y=" + yCor + "&srid=25832",
            dataType: "json",
        })
        .success(function (response) {
            if (response.length === 0) {
                alert('Empty response');
            }
            else {
                app.address = response.vejstykke.adresseringsnavn + " " + response.husnr;

                var clone = app.project.layers[0].model[0].clone();
                clone.geometry.computeBoundingBox();
                var boundingBox = clone.geometry.boundingBox;
                var position = new THREE.Vector3();
                position.subVectors(boundingBox.max, boundingBox.min);
                position.multiplyScalar(0.5);
                position.add(boundingBox.min);
                position.applyMatrix4(clone.matrixWorld);

                var n = new Date().getTime();
                var total = n - d;

            }
        })
        .fail(function (jqXHR, textStatus, errorThrown) {
            console.log("Failed jquery");
        });

    };


    app.getAddress = function (index, callback) {
        var host = "http://dawa.aws.dk";
        var parametre = {};
        var srid = "";
        var zipCodes = [];


        for (var i = 0; i < app.project.plane[index].buildings.model.length; i++) {
            var xCor = app.project.plane[index].buildings.model[i].mapcoords[0];
            var yCor = app.project.plane[index].buildings.model[i].mapcoords[1];


            callAjax(i);
        }

        function callAjax(i) {

            $.ajax({
                url: "http://dawa.aws.dk/adgangsadresser/reverse?x=" + xCor + "&y=" + yCor + "&srid=25832",
                dataType: "json",
            })
            .success(function (response) {
                if (response.length === 0) {
                    console.log("Bad stuff");
                }
                else {
                    var address = response.vejstykke.adresseringsnavn + " " + response.husnr + ", " + response.postnummer.nr;
                    if (app.project.plane[index].buildings.a[i] != undefined) {


                        app.project.plane[index].buildings.a[i]["Adresse"] = address;
          
                        if (response.adgangspunkt.nøjagtighed == "A") {
                            app.project.plane[index].buildings.model[i].material.color.setHex(0x00ff00);
                            app.project.plane[index].buildings.a[i]["Adresse Nøjagtighed"] = "A";
                        } else if (response.adgangspunkt.nøjagtighed == "B") {
                            app.project.plane[index].buildings.model[i].material.color.setHex(0xffff00);
                            app.project.plane[index].buildings.a[i]["Adresse Nøjagtighed"] = "B";
                        } else if (response.adgangspunkt.nøjagtighed == "C") {
                            app.project.plane[index].buildings.model[i].material.color.setHex(0xff0000);
                            app.project.plane[index].buildings.a[i]["Adresse Nøjagtighed"] = "C";
                        }
                    }
                }

                if ($.inArray(response.postnummer.nr, zipCodes) == -1) {
                    zipCodes.push(response.postnummer.nr);
                }
                if (i == app.project.plane[index].buildings.model.length - 1) {
                    callback();
                    app.project.plane[index].buildings.zip = zipCodes;
                }
            })
            .fail(function (jqXHR, textStatus, errorThrown) {
                console.log("Failed jquery");
                if (i == app.project.plane[index].buildings.model.length - 1) {
                    callback();
                    app.project.plane[index].buildings.zip = zipCodes;
                }
            });
        }
    }

    app.searchBuilding = function (value) {
        var layertype = 0; //For polygons
        var featuretype = 0; //for FOT_ID


        for (var i = 0; i < app.project.layers[layertype].a.length; i++) {
         
            if (app.project.layers[layertype].a[i]["FOTID"] == value) {

                app.project.layers[layertype].model[i].geometry.computeBoundingBox();

                var boundingBox = app.project.layers[layertype].model[i].geometry.boundingBox;

                var position = new THREE.Vector3();
                position.subVectors(boundingBox.max, boundingBox.min);
                position.multiplyScalar(0.5);
                position.add(boundingBox.min);

                app.scene.updateMatrixWorld();
                position.applyMatrix4(app.project.layers[layertype].model[i].matrixWorld);

                app.camera.position.set(position.x, position.y, 10);
                app.controls.target = position;
            }
        }

    };

    app.updateTile = function (obj, object, layerId, featureId) {

        if (app.highlightPlane) {

            app.scene.remove(app.highlightPlane);
            app.highlightPlane = null;
            var folder = Q3D.gui.gui.__folders["Selected Feature"];
            Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
            delete Q3D.gui.gui.__folders["Selected Feature"];

        }


        if (object.userData.url != undefined) { //Plane is clicked
            if (app.highlightObject) {
                app.scene.remove(app.highlightObject);
                app.highlightObject = null;

                var folder = Q3D.gui.gui.__folders["Selected Feature"];
                Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
                delete Q3D.gui.gui.__folders["Selected Feature"];

                //We already have a plane, so we remove the old one
                app.closePopup();
            }

            var d = object.userData;

            var clone = object.clone();
            clone.material = app.highlightMaterial;
            var s = 1.0;

            clone.geometry.computeBoundingBox();
            var boundingBox = clone.geometry.boundingBox;

            var position = new THREE.Vector3();
            position.subVectors(boundingBox.max, boundingBox.min);
            position.multiplyScalar(0.5);
            position.add(boundingBox.min);
            //clone.userData.layerId = null;
            position.applyMatrix4(clone.matrixWorld);
            clone.scale.set(clone.scale.x * s, clone.scale.y * s, clone.scale.z * s);
            var highlightPlane = clone;
            app.scene.add(highlightPlane);
            app.highlightPlane = highlightPlane;

            //If we dont have the menu, open it
            if (Q3D.gui.gui.__folders["Selected Feature"] == undefined) {
              
                var folder = Q3D.gui.gui.addFolder("Selected Feature");

                /*
                Functionalities for planes (color is just a test)
                */
                var index = d.index;
                var detail = app.project.plane[index].detail;



                //Add geoJSON file to the current tile
                folder.add(Q3D.gui.parameters, 'getbounds').name('geoJSON').onFinishChange(function (url) {
                    app.getGeoJson(index, url);
                    //TODO do this in the callback to make sure it doesnt go wrong
                    detail.layers.push({ url: url, viz: false });
                });
                /*
             Display the spectrum if there is a maxmin list on the plane
  
             */

                if (app.project.plane[index].buildings != undefined) {
                    if (app.project.plane[index].buildings.maxmin != undefined) {
                        if (app.project.plane[index].buildings.maxmin[app.project.plane[index].spectrumData] != undefined) {
                            initSpectrum(app.project.plane[index].buildings.maxmin[app.project.plane[index].spectrumData], "Building", app.project.plane[index].spectrumData);
                        }
                    }
                }

                //No buildings are present, give the opportunity to create them
                if (detail.buildings == 0) {

                    folder.add(Q3D.gui.parameters, 'resolution').name('Load Buildings').onChange(function () {
                        app.getBuildings(app.project.plane[index], object.userData.xmin, object.userData.ymin, object.userData.xmax, object.userData.ymax, object.userData.row, object.userData.column, object.userData.url, false,
                        function () {
                            detail.buildings = 1;
                            app.updateTile(obj, object, layerId, featureId);

                        });
                    });


                    //Merged buildings are present, give the opportunity to add them to the octree, or to to level 0 again.
                } else if (detail.buildings == 1) {

                    folder.add(Q3D.gui.parameters, 'resolution').name('Toggle Octree').onChange(function () {
                        app.project.plane[index].buildings.model.forEach(function (building) {
                            app.octree.add(building);
                        });

                        app.octreeNeedsUpdate = true;
                        detail.buildings = 2;
                        app.updateTile(obj, object, layerId, featureId);
                    });

                    folder.add(Q3D.gui.parameters, 'resolution').name('Remove Buildings').onChange(function () {
                        app.project.plane[index].buildings.model.forEach(function (building) {
                            app.octree.remove(building);
                            app.scene.remove(building);
                        });
                        if (app.project.plane[index].buildings.block != undefined) {
                            app.project.plane[index].buildings.block.forEach(function (building) {
                                app.octree.remove(building);
                                app.scene.remove(building);
                            });
                        }
                        app.octreeNeedsUpdate = true;
                        delete app.project.plane[index].buildings;
                        app.scene.remove(app.project.plane[index].mergeMesh);
                        app.octree.remove(app.project.plane[index].mergeMesh);
                        app.octreeNeedsUpdate = true;
                        delete app.project.plane[index].mergeMesh;
                        detail.buildings = 0;
                        detail.address = false;
                        app.updateTile(obj, object, layerId, featureId);
                    });

                    //Buildings are in the octree, give the opportunity to remove them from the octree, or remove them completely
                } else if (detail.buildings == 2) {
                    folder.add(Q3D.gui.parameters, 'resolution').name('Toggle Octree').onChange(function () {
                        app.project.plane[index].buildings.model.forEach(function (building) {
                            app.octree.remove(building);
                            app.scene.remove(building);
                        });
                        app.octreeNeedsUpdate = true;
                        detail.buildings = 1;
                        app.updateTile(obj, object, layerId, featureId);
                    });

                    folder.add(Q3D.gui.parameters, 'resolution').name('Remove Buildings').onChange(function () {
                        app.project.plane[index].buildings.model.forEach(function (building) {
                            app.octree.remove(building);
                            app.scene.remove(building);

                        });
                        if (app.project.plane[index].buildings.block != undefined) {
                            app.project.plane[index].buildings.block.forEach(function (building) {
                                app.octree.remove(building);
                                app.scene.remove(building);
                            });
                        }
                        app.octreeNeedsUpdate = true;
                        delete app.project.plane[index].buildings;
                        app.scene.remove(app.project.plane[index].mergeMesh);
                        app.octree.remove(app.project.plane[index].mergeMesh);
                        app.octreeNeedsUpdate = true;
                        delete app.project.plane[index].mergeMesh;
                        app.octreeNeedsUpdate = true;
                        detail.buildings = 0;
                        detail.address = false;
                        app.updateTile(obj, object, layerId, featureId);
                    });
                }


                if (detail.address == false && detail.buildings > 0) {
                    folder.add(Q3D.gui.parameters, 'resolution').name('Get Addresses').onChange(function () {
                        app.getAddress(d.index, function () {

                            app.updateTile(obj, object, layerId, featureId);
                        });
                        detail.address = true;
                    });
                }

                if (detail.address == true && detail.buildings > 0) { //Fail safe
                    folder.add(Q3D.gui.parameters, 'Source').name('Add Datasource').onFinishChange(function (url) {
                        startCorrelation(url, app.project.plane[index].buildings.zip, function (json) {

                            var maxmin = json.pop();
                            app.project.plane[index].buildings.maxmin = maxmin;
                            //For every building in the tile, if address match, add a new group of attributes uData
                            app.project.plane[index].buildings.a.forEach(function (a, i) {

                                json.forEach(function (json) {
                                    if (a != null) {
                                        if (a["Adresse"] == json.addr) {
                                            app.project.plane[index].buildings.model[i].userData.uData = json;
                                        }
                                    }
                                });
                            });
                        });

                    });
                    if (app.project.plane[index].buildings != undefined) {
                        if (app.project.plane[index].buildings.maxmin != undefined) {
                            folder.add(Q3D.gui.parameters, 'resolution').name('Visualize Data').onChange(function () {
                                var maxminlist = app.project.plane[index].buildings.maxmin;

                                initVizMenu(maxminlist);

                                startViz(function (colour_data, height_data, vizComplete) {

                                    var doColour = (colour_data != 'default');
                                    var doHeight = (height_data != 'default');
                                    var colour_method = 'none';
                                    var height_method = 'none';

                                    if (doColour) {
                                        colour_method = (document.getElementById('c_building').checked) ? 'building' : 'block';
                                        initSpectrum(maxminlist[colour_data], "Building", colour_data);
                                        app.project.plane[index].spectrumData = colour_data;
                                    }
                                    if (doHeight) {
                                        height_method = (document.getElementById('h_building').checked) ? 'building' : 'block';
                                    }

                                    //Spectrum image for turning normalized data to a color
                                    var img = document.getElementById('spectrum');
                                    var canvas = document.createElement('canvas');
                                    canvas.width = img.width;
                                    canvas.height = img.height;
                                    var ctx = canvas.getContext('2d');
                                    ctx.drawImage(img, 0, 0, img.width, img.height);

                                    //Define buildings for easier variables
                                    var buildings = app.project.plane[index].buildings;

                                    //Reset blocks
                                    if (buildings.block != undefined) {
                                        buildings.block.forEach(function (block) {
                                            app.scene.remove(block);
                                        });
                                    }
                                    //Reset viz
                                    buildings.model.forEach(function (model, i) {
                                        var color = 0xffffff;
                                        var material = new THREE.MeshLambertMaterial({
                                            color: color,
                                            polygonOffset: true,
                                            polygonOffsetFactor: 0.2,
                                            polygonOffsetUnits: 1.0
                                        });

                                        model.scale.set(1, 1, 1);
                                        model.material = material;
                                    });

                                    buildings.model.forEach(function (model, i) {
                                        if (model.userData.uData != undefined) {
                                            //Calculate normalized value [0; 1]
                                            if (doColour) {
                                                var x = model.userData.uData[colour_data];
                                                if (x != undefined) {

                                                    var x_max = maxminlist[colour_data].max;
                                                    var x_min = maxminlist[colour_data].min;
                                                    var x_norm = (x - x_min) / (x_max - x_min);

                                                    var x_img = (x_norm * canvas.width - 1) | 0;

                                                    var colour = {};
                                                    if (!isNaN(x_img)) {
                                                        colour = ctx.getImageData(x_img, 5, 1, 1);
                                                    } else {
                                                        colour.data = [0, 0, 0];
                                                    }

                                                    if (colour_method == 'building') {
                                                        // Translate normalized value to RGB
                                                        var color = 0xffffff;
                                                        var material = new THREE.MeshLambertMaterial({
                                                            color: color,
                                                            polygonOffset: true,
                                                            polygonOffsetFactor: 0.2,
                                                            polygonOffsetUnits: 1.0
                                                        });
                                                        model.material = material;
                                                        model.material.color.setRGB(colour.data[0] / 255, colour.data[1] / 255, colour.data[2] / 255);

                                                    } else if (colour_method == 'block') {
                                                        if (buildings.block == undefined) {
                                                            buildings.block = [];
                                                        }
                                                        var color = 0xffffff;
                                                        var material = new THREE.MeshLambertMaterial({
                                                            color: color,
                                                            polygonOffset: true,
                                                            polygonOffsetFactor: 0.2,
                                                            polygonOffsetUnits: 1.0
                                                        });

                                                        var geometry = new THREE.BoxGeometry(1, 1, 1);
                                                        var cube = new THREE.Mesh(geometry, material);
                                                        cube.scale.set(0.5, 0.5, 1);
                                                        //Compute the buildings bounding box so we can get the center point
                                                        //If the model is just a block, we get the same block
                                                        model.geometry.computeBoundingBox();

                                                        var boundingBox = model.geometry.boundingBox;

                                                        var position = new THREE.Vector3();
                                                        position.subVectors(boundingBox.max, boundingBox.min);
                                                        position.multiplyScalar(0.5);
                                                        position.add(boundingBox.min);

                                                        position.applyMatrix4(model.matrixWorld);
                                                        cube.material = material;
                                                        //Divide by 255 as setRGB takes values between 0 - 1
                                                        cube.material.color.setRGB(colour.data[0] / 255, colour.data[1] / 255, colour.data[2] / 255);

                                                        cube.position.set(position.x, position.y, 0);
                                                        app.scene.add(cube);
                                                        buildings.block.push(cube);
                                                    }
                                                }
                                            }
                                            if (doHeight) {
                                                var x = model.userData.uData[height_data];
                                                if (x != undefined) {
                                                    var x_max = maxminlist[height_data].max;
                                                    var x_min = maxminlist[height_data].min;
                                                    var x_norm = (x - x_min) / (x_max - x_min);

                                                    var max_height = 20;
                                                    var min_height = 2;
                                                    var x_height = min_height + (max_height - min_height) * x_norm;

                                                    if (height_method == 'building') {
                                                        // Translate normalized value to height
                                                        // Height-min: 2, height-max: 4
                                                        model.scale.set(model.scale.x, model.scale.y, x_height);
                                                    } else if (height_method == 'block') {

                                                        if (buildings.block == undefined) {
                                                            buildings.block = [];
                                                        }

                                                        //If we dident already use blocks for the previous method
                                                        if (cube == undefined) {
                                                            var color = 0xffffff;
                                                            var material = new THREE.MeshLambertMaterial({
                                                                color: color,
                                                                polygonOffset: true,
                                                                polygonOffsetFactor: 0.2,
                                                                polygonOffsetUnits: 1.0
                                                            });

                                                            var geometry = new THREE.BoxGeometry(1, 1, 1);
                                                            var cube = new THREE.Mesh(geometry, material);

                                                            model.geometry.computeBoundingBox();

                                                            var boundingBox = model.geometry.boundingBox;

                                                            var position = new THREE.Vector3();
                                                            position.subVectors(boundingBox.max, boundingBox.min);
                                                            position.multiplyScalar(0.5);
                                                            position.add(boundingBox.min);

                                                            position.applyMatrix4(model.matrixWorld);
                                                            cube.position.set(position.x, position.y, 0);
                                                            cube.scale.set(0.5, 0.5, x_height);
                                                            cube.translateZ(x_height / 2);

                                                            app.scene.add(cube);
                                                            buildings.block.push(cube);
                                                        } else { //If we already created a block, we dont create it twice, we just change its height
                                                            cube.scale.set(0.5, 0.5, x_height);
                                                            cube.translateZ(x_height / 2);
                                                        }
                                                    } // Add other methods of height viz here
                                                }

                                            } // Add other visiualization techniques here (Opacity? Sprites above buildings?)

                                        }
                                    });
                                    vizComplete();
                                })
                            });
                        }
                    }

                }



                /*
                Change resolution
                */
                if (detail.resolution == false) {
                    folder.add(Q3D.gui.parameters, 'resolution').name('Enhance Resolution').onChange(function () {
                        app.updateResolution(object,detail, 1, 512, 512);
                        detail.resolution = true;
                        app.updateTile(obj, object, layerId, featureId);
                    });
                }


                folder.addColor(Q3D.gui.parameters, 'color').name('Color Selected').onChange(function (color) {
                    var pColor = color.replace('#', '0x');
                    object.material.color.setHex(pColor);
                });


                folder.open();

            } else { //If we have the menu, close it unless we have a new highlight
                

                var folder = Q3D.gui.gui.__folders["Selected Feature"];
                Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
                delete Q3D.gui.gui.__folders["Selected Feature"];

                if (layerId != null && featureId != null) {
                    var folder = Q3D.gui.gui.addFolder("Selected Feature");
                    folder.open();
                }
            }

        } else if (object.userData.type == "building") {


            while (object) {
                layerId = object.userData.layerId,
                featureId = object.userData.featureId;
                if (layerId !== undefined) break;
                // object = object.parent;
            }

            if (app.highlightObject == null) {
                app.showQueryResult(obj.point, layerId, featureId, "building");


                //If app.highlightobject is set:
            } else {
                if (featureId == app.highlightObject.userData.featureId) {

                    layerId = undefined;
                    featureId = undefined;
                    app.closePopup();
                } else {

                    app.showQueryResult(obj.point, layerId, featureId, "building");
                }

            }

            app.highlightFeature((layerId === undefined) ? null : layerId,
                               (featureId === undefined) ? null : featureId, "building");

        } else {
            while (object) {
                layerId = object.userData.layerId,
                featureId = object.userData.featureId;
                var planeId = object.userData.planeId;
                if (layerId !== undefined) break;
            }

            if (app.highlightObject == null) {
                app.showQueryResult(obj.point, layerId, featureId, "layer", planeId);
            } else {
                if (featureId == app.highlightObject.userData.featureId) {
                    layerId = undefined;
                    featureId = undefined;
                    var planeId = undefined;
                    app.closePopup();
                } else {
                    app.showQueryResult(obj.point, layerId, featureId, "layer", planeId);
                }
            }

            app.highlightFeature((layerId === undefined) ? null : layerId,
                                (featureId === undefined) ? null : featureId, "layer", planeId);


            if (Q3D.Options.debugMode && object instanceof THREE.Mesh) {
                var face = obj.face,
                    geom = object.geometry;
                if (face) {
                    if (geom instanceof THREE.Geometry) {
                        var v = object.geometry.vertices;
                    }
                    else {
                        console.log("Qgis2threejs: [DEBUG] THREE.BufferGeometry");
                    }
                }
            }
        }

    };
    // Called from *Controls.js when canvas is clicked
    app.canvasClicked = function (e) {
        var canvasOffset = app._offset(app.renderer.domElement);
        var offsetX = e.clientX - canvasOffset.left
        var offsetY = e.clientY - canvasOffset.top
        //var objs = app.intersectObjects(e.clientX - canvasOffset.left, e.clientY - canvasOffset.top);


        var x = (offsetX / app.width) * 2 - 1;
        var y = -(offsetY / app.height) * 2 + 1;
        var vector = new THREE.Vector3(x, y, 1);
        vector.unproject(app.camera);
        var ray = new THREE.Raycaster(app.camera.position, vector.sub(app.camera.position).normalize());


        var start = new Date().getTime();

        var objs = ray.intersectObjects(app.queryableObjects());

        var end = new Date().getTime();
        var time = end - start;
 

        //for (var i = 0, l = objs.length; i < l; i++) {
        var obj = objs[0];



        var object = obj.object, layerId, featureId;

        var layerId = object.userData.layerId;
        var featureId = object.userData.featureId;

        //We got a plane
        if (app.highlightPlane) {
            if (app.highlightPlane.userData.index == object.userData.index) {

                app.scene.remove(app.highlightPlane);
                app.highlightPlane = null;

                var folder = Q3D.gui.gui.__folders["Selected Feature"];
                Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
                delete Q3D.gui.gui.__folders["Selected Feature"];
                return;
            }



        }

        app.updateTile(obj, object, layerId, featureId);

        return;
        //  }
        app.closePopup();
    };

    app.saveCanvasImage = function (width, height, fill_background) {
        if (fill_background === undefined) fill_background = true;

        // set canvas size
        var old_size;
        if (width && height) {
            old_size = [app.width, app.height];
            app.setCanvasSize(width, height);
        }

        // functions
        var saveBlob = function (blob) {
            var filename = "image.png";

            // ie
            if (window.navigator.msSaveBlob !== undefined) {
                window.navigator.msSaveBlob(blob, filename);
                app.popup.hide();
            }
            else {
                // create object url
                if (app._canvasImageUrl) URL.revokeObjectURL(app._canvasImageUrl);
                app._canvasImageUrl = URL.createObjectURL(blob);

                // display a link to save the image
                var e = document.createElement("a");
                e.className = "download-link";
                e.href = app._canvasImageUrl;
                e.download = filename;
                e.innerHTML = "Save";
                app.popup.show("Click to save the image to a file." + e.outerHTML, "Image is ready");
            }
        };

        var saveCanvasImage = function (canvas) {
            if (canvas.toBlob !== undefined) {
                canvas.toBlob(saveBlob);
            }
            else {    // !HTMLCanvasElement.prototype.toBlob
                // https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement.toBlob
                var binStr = atob(canvas.toDataURL("image/png").split(',')[1]),
                    len = binStr.length,
                    arr = new Uint8Array(len);

                for (var i = 0; i < len; i++) {
                    arr[i] = binStr.charCodeAt(i);
                }

                saveBlob(new Blob([arr], { type: "image/png" }));
            }
        };


        var restoreCanvasSize = function () {
            // restore canvas size
            if (old_size) app.setCanvasSize(old_size[0], old_size[1]);
            app.render();
        };

        // background option
        if (!fill_background) app.renderer.setClearColor(0, 0);

        // render
        app.renderer.preserveDrawingBuffer = true;
        app.renderer.render(app.scene, app.camera);

        // restore clear color
        var bgcolor = Q3D.Options.bgcolor;
        app.renderer.setClearColor(bgcolor || 0, (bgcolor === null) ? 0 : 1);


        if ((fill_background && bgcolor === null)) {
            var canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            var ctx = canvas.getContext("2d");
            if (fill_background && bgcolor === null) {
                // render "sky-like" background
                var grad = ctx.createLinearGradient(0, 0, 0, height);
                grad.addColorStop(0, "#98c8f6");
                grad.addColorStop(0.4, "#cbebff");
                grad.addColorStop(1, "#f0f9ff");
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, width, height);
            }

            var image = new Image();
            image.onload = function () {
                // draw webgl canvas image
                ctx.drawImage(image, 0, 0, width, height);


                // save canvas image
                saveCanvasImage(canvas);
                restoreCanvasSize();
            };
            image.src = app.renderer.domElement.toDataURL("image/png");
        }
        else {
            // save webgl canvas image
            saveCanvasImage(app.renderer.domElement);
            restoreCanvasSize();
        }
    };



    app.getGeoJson = function (indexPlane, url) {

        if (app.BufferBox == undefined) {
            var pGeometry = new THREE.BoxGeometry(1, 1, 1);
            app.BufferBox = new THREE.BufferGeometry().fromGeometry(pGeometry);
        }
        var plane = app.project.plane[indexPlane];
        var xmin = plane.mesh.userData.xmin;
        var ymin = plane.mesh.userData.ymin;
        var xmax = plane.mesh.userData.xmax;
        var ymax = plane.mesh.userData.ymax;
        var row = plane.mesh.userData.row * 2 + 1;
        var column = plane.mesh.userData.column * 2 + 1;
        var bbox = "&Bbox=" + xmin + "," + ymin + "," + xmax + "," + ymax
        var count = 0;
        var proxy = 'http://nodejs-geovizjs.rhcloud.com/'
        app.wmsready = false;
        $.ajax({
            url: proxy + url + bbox,
            dataType: "json",
        })
       .success(function (response) {
          
           console.log("Found: " + response.features.length + " Features");

           if (response.features.length > 0) {
               if (plane.layers == undefined) {
                
                   plane.layers = [];
               }

               var index = plane.layers.length;
               plane.layers.push(response);

               plane.layers[index].model = [];
               plane.layers[index].a = [];
               plane.layers[index].name = "GeoJson " + index;
               plane.layers[index].maxmin = {};
               var points = [];
               for (var i = 0; i < response.features.length; i++) {
                   //Determine geometry type
                   if (response.features[i].geometry.type == "Point" || response.features[i].geometry.type == "MultiPoint") {
                       //If point, create a point object. 

                       var material = new THREE.MeshLambertMaterial({
                           color: 0xffaaaa,
                       });
                       //   var pGeometry = new THREE.BoxGeometry(1,1,1);
                       var mesh = new THREE.Mesh(app.BufferBox, material);
                       var x = response.features[i].geometry.coordinates[0];
                       var y = response.features[i].geometry.coordinates[1];
                       var z = 1;

                       var widthP = app.project.width;
                       var heightP = app.project.height;

                       var widthM = xmax - xmin;
                       var heightM = ymax - ymin;

                       var factorX = widthP / widthM;
                       var factorY = heightP / heightM;

                       var ptx = (widthP * (column) / 2) - (((xmax - x) * factorX));
                       var pty = (heightP * (row) / 2) - (((ymax - y) * factorY));



                       mesh.position.set(ptx, pty, 0.5);


                       mesh.userData.layerId = index;
                       mesh.userData.planeId = indexPlane;
                       mesh.userData.featureId = i;

                       plane.layers[index].model[i] = mesh;
                       plane.layers[index].a[i] = plane.layers[index].features[i].properties;

                       app.scene.add(mesh);
                   }
                   else if (response.features[i].geometry.type == "Polygon" || response.features[i].geometry.type == "MultiPolygon") {


                       var fxmin = Infinity;
                       var fxmax = 0
                       var fymin = Infinity;
                       var fymax = 0;
                       if (response.features[i].geometry.type == "Polygon") {
                           var length = response.features[i].geometry.coordinates[0].length;
                           var polygon = "Polygon";
                       } else {
                           var length = response.features[i].geometry.coordinates[0][0].length;
                           var polygon = "MultiPolygon";
                       }

                       for (var j = 0; j < length; j++) {

                           if (polygon == "MultiPolygon") {
                               var x = response.features[i].geometry.coordinates[0][0][j][0];
                               var y = response.features[i].geometry.coordinates[0][0][j][1];
                           } else {
                               var x = response.features[i].geometry.coordinates[0][j][0];
                               var y = response.features[i].geometry.coordinates[0][j][1];
                           }
                           if (x < fxmin) {
                               fxmin = x;
                           }
                           if (x > fxmax) {
                               fxmax = x;
                           }
                           if (y < fymin) {
                               fymin = y;
                           }
                           if (y > fymax) {
                               fymax = y;
                           }


                           //In each direction
                           var widthP = app.project.width;
                           var heightP = app.project.height;

                           var widthM = xmax - xmin;
                           var heightM = ymax - ymin;

                           var factorX = widthP / widthM;
                           var factorY = heightP / heightM;

                           var ptx = (widthP * (column) / 2) - (((xmax - x) * factorX));
                           var pty = (heightP * (row) / 2) - (((ymax - y) * factorY));

                           var point = new THREE.Vector2(ptx, pty);
                           points.push(point);

                       }

                       //Create a center point
                       var centerX = fxmin + ((fxmax - fxmin) / 2);
                       var centerY = fymin + ((fymax - fymin) / 2);

                       if (centerX > xmin && centerX < xmax && centerY > ymin && centerY < ymax) {


                           var shape = new THREE.Shape(points);
                           var extrudeSettings = {
                               amount: 1.2,
                               steps: 1,
                               material: 0,
                               extrudeMaterial: 1,
                               bevelEnabled: false
                           };

                           //build a geometry (ExtrudeGeometry) from the shape and extrude settings
                           var geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                           geometry.dynamic = true;

                           var color = 0xffffff;
                           var material = new THREE.MeshPhongMaterial({
                               color: color
                           });

                           var mesh = new THREE.Mesh(geometry, material);;
                           mesh.userData.planeId = indexPlane;
                           mesh.userData.layerId = index;
                           mesh.userData.featureId = plane.layers[index].model.length;

                           plane.layers[index].model.push(mesh);
                           plane.layers[index].a.push(plane.layers[index].features[i].properties);

                           mesh.position.z = -2

                           app.scene.add(mesh);
                           points = [];
                           count++;
                       } 
                       points = [];
                   }

                   //First iteration, and we need to build the max min object
                   if (count == 1) {
                       for (var key in plane.layers[index].a[count-1]) {

                           plane.layers[index].maxmin[key] = { max: 0, min: Infinity };
                       }
                   }
                   for (var key in plane.layers[index].a[count-1]) {
                       if (isNumeric(plane.layers[index].a[count-1][key])) {
                           if (plane.layers[index].a[count-1][key] > plane.layers[index].maxmin[key].max) {
                               plane.layers[index].maxmin[key].max = plane.layers[index].a[count-1][key];

                           } else if (plane.layers[index].a[count-1][key] < plane.layers[index].maxmin[key].min) {

                               plane.layers[index].maxmin[key].min = plane.layers[index].a[count-1][key];
                           }
                       }
                   }

                   //Will return strings as numbers, if they can be interpreted as such
                   function isNumeric(n) {
                       return !isNaN(parseFloat(n)) && isFinite(n); //&& noComma;
                   }

               }

           }
           //key had no numeric entries so we can visualize it
           for (var key in plane.layers[index].maxmin) {
               if (plane.layers[index].maxmin[key].min == Infinity || plane.layers[index].maxmin[key].max == 0) {
                   delete plane.layers[index].maxmin[key];
               }
           }
           app.queryObjNeedsUpdate = true;

           app.queryableObjects();
           app.octreeNeedsUpdate = true;
           app.octree.update();
           app.wmsready = true;
           var position = { x: 1, y: 1, z: -2 };
           var target = { x: 1, y: 1, z: 0 };
           var tween = new TWEEN.Tween(position).to(target, 3000);

           tween.onUpdate(function () {
               plane.layers[index].model.forEach(function (mesh) {
                   mesh.position.set(mesh.position.x, mesh.position.y, position.z);
               });
           });
           tween.start();
       })
       .fail(function (jqXHR, textStatus, errorThrown) {
           console.log("Failed jquery");
       });
    };
})();