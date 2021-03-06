﻿/*
*  First function at application start
*  Loads a chosen scene if observer, starts init menu if builder
*/

var initScene = function () {

    document.getElementById('loader').style.display = 'block';
    var _scene = 'DTU.json'; //Name of default scene

    if (window.sessionStorage.userRole == "builder") {
        // Load default scene
        if (window.sessionStorage.scene != undefined) {
            _scene = window.sessionStorage.scene;
        }
        loadProject(_scene, function () {
            document.getElementById('loader').style.display = 'none';
            openStartMenu();
        });
        Q3D.gui.init();
    }
    else if (window.sessionStorage.userRole == "observer") {
        // Load scene chosen at login screen (window.sessionStorage.scene)
        _scene = window.sessionStorage.scene;

        //EKSTERN LOAD
        loadProject(_scene, function () {
            document.getElementById('loader').style.display = 'none';
        });
    } else {
        alert('Login required to access GeoViz');
        window.location = 'index.html';
    }
}

loadProject = function (scene_name, callback) {
    var url = 'https://api-geovizjs.rhcloud.com/loadProject/';
    url = url + '?scene=' + scene_name;
    $.ajax({
        url: url,
        type: 'GET',
        data: {'project' : scene_name},
        success: function (json_project) {
            app.loadProject(JSON.parse(json_project));
            app.start();
            app.addEventListeners();
            callback();
        },
        error: function (err) {
            console.log(err);;
        }
    });
}

localLoad = function (callback) {
    //LOKAL VERSION TIL TESTING
    $.getJSON("Blocktest.json", function (json) {
        app.loadProject(json);
        app.start();
        app.addEventListeners();
        callback();
        // this will show the info it in firebug console
    });
}

/*
*  Initializes static parts of modal menus and button functions
*/
var initGUI = function () {
    // Get the modals
    var modal1 = document.getElementById('modal-menu');
    var modal2 = document.getElementById('modal-viz');
    var modal3 = document.getElementById('start-modal');
    var modal4 = document.getElementById('save-modal');

    // Get the <span> element that closes the modals
    var spans = document.getElementsByClassName('close');

    // Get the loading circle
    var loader = document.getElementById('loader');
    document.getElementById('spectrum-div').style.display = 'none';
    // When the user clicks on <span> (x), close the modal
    spans[0].onclick = function () {
        clearSelectMenus();
        modal1.style.display = 'none';
    }
    spans[1].onclick = function () {
        document.getElementById('start_viz').innerHTML = 'Visualize';
        //resetVizMenu();
        modal2.style.display = 'none';
    }
    spans[2].onclick = function () {
        closeStartMenu();
    }
    spans[3].onclick = function () {
        closeSaveMenu();
    }

    //--------------------------------------- TESTING FUNCTIONS ------------------------------------
    window.onkeyup = function (e) {
        var key = e.keyCode ? e.keyCode : e.which;

        if (key == 27) {
            document.getElementById('loader').style.display = 'none';
        }
    }

    //----------------------------------------------------------------------------------------------
}
/*
*   Takes url of external .csv file, list of zip codes within tile, and a callback
*   And opens a modal menu from the headers of the CSV.
*/
var startCorrelation = function (sourceURL, tile_zip, callback) {
    var url = 'http://api-geovizjs.rhcloud.com/getSourceHeaders?sourceURL=' + sourceURL;
    clearSelectMenus();
    $.ajax({
        url: url,
        type: 'GET',
        dataType: 'json',
        success: function (json) {
            //Clear options from previous data loads
            fillSelectMenus(json);

            //Init button for starting construction
            var buildbtn = document.getElementById('build');
            buildbtn.onclick = function () {
                var street = document.getElementById('select_street');
                var num = document.getElementById('select_streetnum');
                var zip = document.getElementById('select_zip');

                var street_sel = street.options[street.selectedIndex].value;
                var num_sel = num.options[num.selectedIndex].value;
                var zip_sel = zip.options[zip.selectedIndex].value;

                if (street_sel == "default" || num_sel == "default" || zip_sel == "default") {
                    document.getElementById("loader").style.display = "none";
                    alert("Argument(s) missing");
                } else {
                    var block = {
                        street: street_sel,  //document.getElementById('select_street').value,
                        num: num_sel,        //document.getElementById('select_streetnum').value,
                        zip: zip_sel,         //document.getElementById('select_zip').value
                        sourceURL: sourceURL,
                        tile_zip: tile_zip
                    }
                    startBuild(block, callback);
                }
            }

            document.getElementById('modal-viz').style.display = 'none';
            //Init select menus for address construction
            var modal = document.getElementById('modal-menu');
            modal.style.display = "block";
        },
        error: function (err) {
            console.log('ERROR');
            console.log(err);
        }
    });
}

/*
*   Takes parameters from the address construction modal
*   and parses csv while constructing addresses from chosen params.
*   then returns csv as json to the given callback
*/
var startBuild = function (param_block, callback) {
    var url = 'http://api-geovizjs.rhcloud.com/parseCSV';
    document.getElementById("build").innerHTML = "Constructing Addresses";
    document.getElementById("loader").style.display = "block";

    $.ajax({
        url: url,
        type: 'GET',
        data: param_block,
        dataType: 'json',
        success: function (csv_as_json) {
            document.getElementById("build").innerHTML = "Construction Successful";
            document.getElementById("loader").style.display = "none";
            callback(csv_as_json);
        },
        error: function (err) {
            document.getElementById("build").innerHTML = "Construction Failed. Try Again?";
            document.getElementById("loader").style.display = "none";
            console.log(err);

        }
    });
}

/*
*   Removes all options except default from address-construction modal
*/
var clearSelectMenus = function () {
    var street = document.getElementById('select_street');
    var num = document.getElementById('select_streetnum');
    var zip = document.getElementById('select_zip');

    street.options.length = 1;
    num.options.length = 1;
    zip.options.length = 1;
}

/*
*
*/
var fillSelectMenus = function (json) {

    //Address Builder Modal
    var street = document.getElementById('select_street');
    var num = document.getElementById('select_streetnum');
    var zip = document.getElementById('select_zip');

    for (var key in json) {
        street.options.add(new Option(json[key], json[key]));
        num.options.add(new Option(json[key], json[key]));
        zip.options.add(new Option(json[key], json[key]));
    }
};

var startViz = function (callback) {
    // avoid having two open modal menus at once
    document.getElementById('modal-menu').style.display = 'none';

    // Add button to begin visualization (created here to gain scope to callback)
    var vizButton = document.getElementById('start_viz');
    var loader = document.getElementById('loader');

    vizButton.onclick = function () {
        // Inform user that loading has begun
        vizButton.innerHTML = 'Loading Visualization';
        loader.style.display = 'block';


        var colour_data = document.getElementById('colour_data');
        var height_data = document.getElementById('height_data');

        var colour_selected = colour_data.options[colour_data.selectedIndex].value;
        var height_selected = height_data.options[height_data.selectedIndex].value;

        if (colour_selected == 'default' && height_selected == 'default') {
            alert('No data source selected');
            loader.style.display = 'none';
            vizButton.innerHTML = 'Select data and try again.';
        } else {
            callback(colour_selected, height_selected, function () {
                vizButton.innerHTML = 'Visualization Complete';
                loader.style.display = 'none';
                console.log('Finished Viz');

            });
        }
    }
    document.getElementById('modal-viz').style.display = 'block';
}

var initVizMenu = function (featurelist) {

    //Data Visualizer Modal
    var colour = document.getElementById('colour_data');
    var height = document.getElementById('height_data');

    colour.options.length = 1;
    height.options.length = 1;

    for (var key in featurelist) {
        colour.options.add(new Option(key, key));
        height.options.add(new Option(key, key));
    }
}

var initSaveList = function () {
    //Grab savedlist div
    var savedlist = document.getElementById('select-save');
    //Empty existing elements
    while (savedlist.firstChild) {
        savedlist.removeChild(savedlist.firstChild);
    }
    var selectMenu = document.createElement('select');

    $.getJSON({
        url: 'https://api-geovizjs.rhcloud.com/savesList/',
        type: 'GET',
        crossDomain: true,
        contentType: "application/json; charset=utf-8",
        header: { 'Access-Control-Allow-Origin': '*' },

        success: function (project_list) {

            for (var project in project_list.saves) {
                var project_name = project_list.saves[project];
                if ((typeof project_name == 'string' && project_name.match(/.json/gi))) {
                    var sel_name = project_name.replace('.json', '');
                    selectMenu.options.add(new Option(sel_name, sel_name));
                }
            }
            savedlist.appendChild(selectMenu);
            var btn = document.getElementById('load-scene');
            btn.innerHTML = 'Select Project From Menu Below';
        },
        error: function (err) {
            var btn = document.getElementById('load-scene');
            btn.innerHTML = 'No Saved Projects';
        }
    });
};


var initTextfield = function () {
    var element = document.getElementById('enter-address');
    var textField = document.createElement('i')
}

var closeStartMenu = function () {
    document.getElementById('load-scene').style.display = 'block';
    document.getElementById('new-scene').style.display = 'block';
    document.getElementById('address-field').style.display = 'none';
    document.getElementById('start-modal').style.display = 'none';
}

var openStartMenu = function () {
    var address_field = document.getElementById('address-field');
    var btn_newScene  = document.getElementById('new-scene');
    var btn_loadScene = document.getElementById('load-scene');
    var address_div = document.getElementById('new-scene-div');
    var startScene = document.getElementById('start-scene');
    var back_arrow = document.getElementById('back_to_start');
    address_field.value = '';
    address_field.style.display = 'none';
    back_arrow.style.display = 'none';

    back_arrow.onclick = function () {
        closeStartMenu();
        openStartMenu();
    }

    btn_newScene.onclick = function () {
        btn_loadScene.style.display = 'none';
        btn_newScene.style.display = 'none';
        address_field.style.display = 'block';
        back_arrow.style.display = 'block';
        startScene.onclick = function () {
            var input = address_field.value;
            if (input != null && input.length > 1) {
                addressToScene(input);
            } else {
                alert('Invalid Address');
            }
        }
    }

    btn_loadScene.onclick = function () {
        var c = confirm('Loading a new scene will cancel the current one.\nContinue?');
        if (c) {
            window.location = 'loadingpage.html';
        }
    }

    startScene.onclick = function () {
        closeStartMenu();
    }
    document.getElementById('start-modal').style.display = 'block';
}

openSaveMenu = function () {
    var project_name_textbox = document.getElementById('project-name-input');
    var btn_save_local = document.getElementById('save-local');
    var btn_save_remote = document.getElementById('save-remote');
    var error_field = document.getElementById('save-error');
    var download_btn = document.getElementById('download-link');
    var download_field = document.getElementById('download-field');
    var loader = document.getElementById('loader');
    error_field.style.display = 'none';
    download_field.style.display = 'none';

    btn_save_remote.onclick = function () {
       
        var project_name = project_name_textbox.value;
        if (project_name != null && project_name.length > 1) {
            loader.style.display = 'block';
            $.ajax({
                type: 'GET',
                url: 'https://api-geovizjs.rhcloud.com/checkName/',
                data: {'project_name' : project_name },
                success: function (data) {
                    var project = app.saveProject(project_name);
                    var block = {
                        project_name: project_name,
                        project: project
                    };

                    var saveBlock = JSON.stringify(block);


                    $.ajax({
                        type: 'POST',
                        url: 'https://api-geovizjs.rhcloud.com/saveProject/',
                        data: saveBlock,
                        contentType: 'application/json',
                        success: function (data) {
                            alert("Saved Project!");
                            //TODO: ADD GUI RESPONSE
                            loader.style.display = 'none';
                        },
                        failure: function (errMsg) {
                            alert("Failed to save project");
                            //TODO: ADD GUI RESPONSE
                            error_field.innerHTML = 'Error Saving Project';
                            error_field.style.display = 'block';
                            loader.style.display = 'none';
                        }
                    });
                },
                error: function (errMsg) {
                    error_field.innerHTML = 'Name Already In Use';
                    error_field.style.display = 'block';
                    loader.style.display = 'none';
                }
            });
        } else {
            error_field.innerHTML = 'Invalid Name';
            error_field.style.display = 'block';
        }
    }

    btn_save_local.onclick = function () {
        var project_name = project_name_textbox.value;
        loader.style.display = 'block';
        if (project_name != null && project_name.length > 1) {
            error_field.style.display = 'none';
            var project = app.saveProject(project_name);
            var json = JSON.stringify(project);
            var blob = new Blob([json], { type: "application/json" });
            var url = URL.createObjectURL(blob);

            if (!project_name.match(/.json/gi)) {
                project_name = project_name + '.json';
            }

            download_btn.download = project_name;
            download_btn.href = url;
            download_field.style.display = 'block';
            loader.style.display = 'none';
        } else {
            loader.style.display = 'none';
            download_field.style.display = 'none';
            error_field.innerHTML = 'Invalid Name';
            error_field.style.display = 'block';
        }
    }
    document.getElementById('save-modal').style.display = 'block';
}


closeSaveMenu = function () {
    var project_name_textbox = document.getElementById('project-name-input');
    var btn_save_local = document.getElementById('save-local');
    var btn_save_remote = document.getElementById('save-remote');
    var error_field = document.getElementById('save-error');
    var download_btn = document.getElementById('download-link');
    var download_field = document.getElementById('download-field');
    project_name_textbox.value = '';
    error_field.style.display = 'none';
    download_field.style.display = 'none';
    document.getElementById('save-modal').style.display = 'none';
}

toggleSpectrum = function (attribute) {
    var spec = document.getElementById('spectrum-div');
    if (spec.style.display == 'none') {
        spec.style.display = 'block';
    } else {
        spec.style.display = 'none';
    }
}
closeSpectrum = function (attribute) {
    var spec = document.getElementById('spectrum-div');
        spec.style.display = 'none';
    
}
openSpectrum = function (attribute) {
    var spec = document.getElementById('spectrum-div');
    spec.style.display = 'block';

}
initSpectrum = function (attribute,type,field) {
    if (attribute != null) {
        var max = attribute.max;
        var min = attribute.min;
        document.getElementById('max-val').innerHTML = max;
        document.getElementById('min-val').innerHTML = min;
        document.getElementById('field-val').innerHTML = field;
        document.getElementById('type').innerHTML = type + ": ";
    }
    document.getElementById('spectrum-div').style.display = 'block';
}

// ------------------------------------- ADDRESS TO SCENE ---------------------------------------------
addressToScene = function (address) {
    var url = "http://dawa.aws.dk/datavask/adresser?betegnelse=" + address;
    document.getElementById('loader').style.display = 'block';
    $.ajax({
        url: url,
        dataType: "json",
    }).success(function (response) {
        $.ajax({
            // url: "http://dawa.aws.dk/adresser/" + response.resultater[0].adresse.id,
            url: "http://dawa.aws.dk/adgangsadresser?id="+response.resultater[0].adresse.adgangsadresseid+"&srid=25832",
            dataType: "json",
        }).success(function (response) {
            /*
            CREATE A STOP RENDER INSTEAD OF 10 RUNTHROUGHS OF THIS
            */

            for (var i = 0; i < 20; i++){
                app.scene.children.forEach(function (child) {
                    if (child instanceof THREE.Mesh) {
                        app.scene.remove(child);
                        app.octree.remove(child);
                    }
                });
            }
            for (var i = 0; i < 5; i++) {
                app.project.layers.forEach(function (layer) {
                          
                    layer.model.forEach(function(child){
                        app.scene.remove(child);
                        app.octree.remove(child);
                        delete child;                   
                    });
                });
            }

            for (var i = 0; i < 5; i++) {
                app.project.plane.forEach(function (plane) {
                    if (plane.buildings !== undefined) {
                        plane.buildings.model.forEach(function (child) {
                            app.scene.remove(child);
                            app.octree.remove(child);
                            delete child;
                                  
                        });
                    }
                    if (plane.layers !== undefined) {
                        plane.layers.forEach(function (layer) {
                            if (layer.model != undefined) {
                                layer.model.forEach(function (child) {
                                    app.scene.remove(child);
                                    app.octree.remove(child);
                                    delete child;
                                })
                            }
                        });
                    }
                });
            }
            app.octreeNeedsUpdate = true;
                 
            var x = response[0].adgangspunkt.koordinater[0];
            var y = response[0].adgangspunkt.koordinater[1];
                  
            app.project.origin.x = x;
            app.project.origin.y = y;

            var tilex = parseFloat((app.project.baseExtent[2] - app.project.baseExtent[0])/2);
            var tiley = parseFloat((app.project.baseExtent[3] - app.project.baseExtent[1])/2);


            var xmin = app.project.baseExtent[0] = x - tilex;
            var ymin = app.project.baseExtent[1] = y - tiley;
            var xmax = app.project.baseExtent[2] = x + tilex;
            var ymax = app.project.baseExtent[3] = y + tiley;
            app.calculatebbox(1);
            app.extendMap(2);
            var url = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";

            //  app.getBuildings(xmin, ymin, xmax, ymax, 0, 0, url, "FOT10",true);

            app.project.layers = [];
        }).fail(function (error) {

            console.log(error);
        })


    }).fail(function(error){ 
          
          
    })
    .done(function (e) {
        document.getElementById('loader').style.display = 'none';
    });

}