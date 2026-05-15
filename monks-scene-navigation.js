import { registerSettings } from "./settings.js";
import { MonksNavigation } from "./apps/scene-navigation.js";
export let debugEnabled = 0;

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: monks-scene-navigation | ", ...args);
};
export let log = (...args) => console.log("monks-scene-navigation | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("WARN: monks-scene-navigation | ", ...args);
};
export let error = (...args) => console.error("monks-scene-navigation | ", ...args);

export const setDebugLevel = (debugText) => {
    debugEnabled = { none: 0, warn: 1, debug: 2, all: 3 }[debugText] || 0;
    // 0 = none, warnings = 1, debug = 2, all = 3
    if (debugEnabled >= 3)
        CONFIG.debug.hooks = true;
};

export let i18n = key => {
    return game.i18n.localize(key);
};
export let setting = key => {
    return game.settings.get("monks-scene-navigation", key);
};

export let patchFunc = (prop, func, type = "WRAPPER") => {
    if (game.modules.get("lib-wrapper")?.active) {
        libWrapper.register("monks-scene-navigation", prop, func, type);
    } else {
        const oldFunc = eval(prop);
        eval(`${prop} = function (event) {
            return func.call(this, ${type != "OVERRIDE" ? "oldFunc.bind(this)," : ""} ...arguments);
        }`);
    }
}

export class MonksSceneNavigation {
    static emit(action, args = {}) {
        args.action = action;
        args.senderId = game.user.id;
        game.socket.emit(MonksSceneNavigation.SOCKET, args, (resp) => { });
    }

    static onMessage(data) {
        MonksSceneNavigation[data.action].call(MonksSceneNavigation, data);
    }

    static pullLevel(data) {
        if (data.sceneId == canvas.scene.id) {
            canvas.scene.view({ level: data.levelId });
        }
    }
}

Hooks.on("init", () => {
    log('Initializing Monks Scene Navigation');
    registerSettings();

    MonksSceneNavigation.SOCKET = "module.monks-scene-navigation";

    CONFIG.ui.nav = MonksNavigation;

    patchFunc("Scene.prototype.activate", function (wrapped, ...args) {
        if (setting("minimize-activate")) {
            ui.nav.toggleExpanded();
        }
        return wrapped(...args);
    });

    CONFIG.ui.scenes.prototype._toggleNavigation = function (event) {
        event.preventDefault();
        event.stopPropagation();

        const scene = game.scenes.get(this.dataset.entryId);
        scene.update({ navigation: !scene.navigation });
    }

    let oldContext = CONFIG.ui.scenes.prototype._getEntryContextOptions;
    CONFIG.ui.scenes.prototype._getEntryContextOptions = function () {
        let options = oldContext.call(this);

        let idx = options.findIndex(o => o.label === "SIDEBAR.Edit");
        if (idx == -1) {
            var permission = {
                label: "SIDEBAR.Edit",
                icon: '<i class="fas fa-edit"></i>',
                visible: () => game.user.isGM,
                callback: async (li) => {
                    const { entryId } = li.closest("[data-entry-id]").dataset;
                    const document = this.collection.get(entryId) ?? await this.collection.getDocument(entryId);
                    document.sheet.render(true);
                }
            };
            let idx = options.findIndex(o => o.label === "SCENE.View")
            options.splice(idx + 1, 0, permission);
        }

        idx = options.findIndex(o => o.label === "SIDEBAR.Export");
        if (idx != -1) {
            var permission = {
                label: "OWNERSHIP.Configure",
                icon: '<i class="fas fa-lock"></i>',
                visible: () => game.user.isGM,
                callback: li => {
                    const document = this.collection.get(li.dataset.entryId);
                    let cls = foundry.applications.apps.DocumentOwnershipConfig;
                    new cls({
                        document,
                        position: {
                            top: Math.min(li.offsetTop, window.innerHeight - 350),
                            left: window.innerWidth - 720
                        }
                    }).render(true);
                }
            };
            options.splice(idx, 0, permission);

            var view_artwork = {
                label: "MonksSceneNavigation.ViewArtwork",
                icon: '<i class="fas fa-image"></i>',
                visible: li => {
                    const document = this.collection.get(li.dataset.entryId);
                    return document.initialLevel.background.src && game.user.isGM;
                },
                callback: li => {
                    const document = this.collection.get(li.dataset.entryId);
                    new foundry.applications.apps.ImagePopout({
                        window: {
                            title: document.name
                        },
                        src: document.initialLevel.background.src,
                        shareable: true,
                        uuid: document.uuid
                    }).render(true);
                }
            };
            options.splice(idx, 0, view_artwork);
        }
    
        return options;
    }

    if (setting("click-to-view")) {
        let clickDocumentName = function (wrapped, ...args) {
            let event = args[0];
            event.preventDefault();
            const document = this.collection.get(event.target.closest(".scene").dataset.entryId);
            if (document instanceof Scene)
                document.view();
            else
                wrapped(...args);
        };

        patchFunc("CONFIG.ui.scenes.prototype._onClickEntry", clickDocumentName, "MIXED");
    }

    let sceneView = function (wrapped, ...args) {
        ui.nav._lastScene = ui.nav._currentScene;
        ui.nav._currentScene = this;
        return wrapped(...args);
    };

    if (game.modules.get("lib-wrapper")?.active) {
        libWrapper.register("monks-scene-navigation", "Scene.prototype.view", sceneView, "MIXED");
    } else {
        const oldSceneView = Scene.prototype.view;
        Scene.prototype.view = function () {
            return sceneView.call(this, oldSceneView.bind(this), ...arguments);
        }
    }
});

Hooks.on("ready", () => {
    game.socket.on(MonksSceneNavigation.SOCKET, MonksSceneNavigation.onMessage);

    if (setting("minimize-activate")) {
        let expanded = game.user.getFlag("monks-scene-navigation", "expanded") || false;
        ui.nav.toggleExpanded(expanded);
    }
})

Hooks.on("renderPermissionControl", (app, html, options) => {
    if (app.object instanceof Scene) {
        $('option[value="1"],option[value="2"]', html).remove();
        $('option[value="3"]', html).html('Observer');
    }
});

Hooks.on("renderDocumentOwnershipConfig", (app, html, options) => {
    if (app.object instanceof Scene) {
        $('option[value="1"],option[value="2"]', html).remove();
        $('option[value="3"]', html).html('Observer');
    }
});

Hooks.on("renderSceneDirectory", (app, html, options) => {
    //add scene indicators
    if (setting("scene-indicator")) {
        $('li.scene', html).each(function () {
            let id = this.dataset.entryId;
            let scene = game.scenes.contents.find(s => { return s.id == id });
            if (scene != undefined) {
                //show active, if players can navigate
                $(this).toggleClass('navigate', scene.navigation);
                let addBackground = setting("directory-background") && ["true", "false"].includes(setting("smaller-directory"));
                $(this).toggleClass('background', addBackground);
                let sceneName = $('a', this).html();
                $('a', this).attr('title', sceneName);

                if (addBackground) {
                    $('a', this).html("").append($("<div>").html(sceneName));
                    if (scene.active)
                        $('a div', this).prepend($('<i>').addClass('fas fa-bullseye'))
                } else if(scene.active)
                    $('a', this).prepend($('<i>').addClass('fas fa-bullseye'));

                if (scene.navigation || setting('quick-navigation') || scene.ownership.default > 0 || Object.keys(scene.ownership).length > 1) {
                    let permissions = $('<div>').addClass('permissions flexrow');
                    if (scene.navigation || setting('quick-navigation')) {
                        if (setting('quick-navigation'))
                            permissions.append($('<a>').append($('<i>').addClass('fas fa-compass').attr('title', 'Navigatable')).click(app._toggleNavigation.bind(this)));
                        else
                            permissions.append($('<i>').addClass('fas fa-compass').attr('title', 'Navigatable'));
                    }
                    if (scene.ownership.default > 0)
                        permissions.append($('<i>').addClass('fas fa-users').attr('title', 'Everyone'));
                    else {
                        for (let [key, value] of Object.entries(scene.ownership)) {
                            let user = game.users.find(u => {
                                return u.id == key && !u.isGM;
                            });
                            if(user != undefined && value > 0)
                                permissions.append($('<div>').css({ backgroundColor: user.color }).html(user.name[0]).attr('title', user.name));
                        }
                    }
                    $(this).append(permissions);
                }
            }
        });
    }
    if (setting("smaller-directory") != "false") {
        let className = setting("smaller-directory") == "none" ? "noimage-directory" : "smaller-directory";
        if (setting("smaller-directory") == "side") className += " side-icon";
        $(html).addClass(className);
    }
});

Hooks.on("updateCombat", async function (combat, delta) {
    if (setting("minimize-combat")) {
        if ((combat && (delta.round === 1 && combat.turn === 0 && combat.started === true))) {
            if (ui.nav.expanded) {
                if (!setting("restore")) {
                    //record the state it was in before combat starts, don't record a false if this is the second combat to start and the nav is already collapsed
                    game.settings.set("monks-scene-navigation", "restore", true);
                }
                ui.nav.toggleExpanded();
            }
        }
    }
});

Hooks.on("deleteCombat", function (combat) {
    if (setting("minimize-combat")) {
        //check to make sure there are no longer any active combats
        if (game.combats.active == undefined) {
            if (setting("restore") && !ui.nav.expanded) {
                ui.nav.toggleExpanded();
                game.settings.set("monks-scene-navigation", "restore", false);
            }
        }
    }
});

Hooks.on("updateScene", function (scene, update, options, userId) {
    if (update.navigation != undefined) {
        ui.scenes.render();
    }
});
