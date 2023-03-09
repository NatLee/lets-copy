function addDomain(domain) {
    if (!(domain in domains_map)) {
        console.log("Add `" + domain + "` into enabled map");
        domains_map[domain] = 1;
        /*
        // for removing storage permission, so need to make it be comments
        chrome.storage.local.set({
            domains: JSON.stringify(domains_map)
        }, () => {})
        */
    }
}

function removeDomain(domain) {
    if (domain in domains_map) {
        console.log("Remove `" + domain + "` from enabled map");
        delete domains_map[domain];
        /*
        // for removing storage permission, so need to make it be comments
        chrome.storage.local.set({
            domains: JSON.stringify(domains_map)
        }, () => {})
        */
    }
}

function needEnableCopy(url) {
    if (url && url.substr(0, 4) == "http") {
        var result = domain_pattern.exec(url);
        if (result && result[1] in domains_map) {
            return true
        }
    }
    return false
}

console.log("Let's Copy Loaded Flag ;)");

var domain_pattern = /^https?:\/\/([^\/]+)/;
var domains_map = {}; // for recording domains need to enable copy next time!
var script_src = chrome.runtime.getURL("./enable.js");
var inject_script = "var script = document.createElement('script');\tscript.src = '" + script_src + "';\tdocument.body.appendChild(script);";

var script = {
    target: {},
    files: ["./enable.js"]
};

chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
}, tabs => {
    let url = tabs[0].url
});

chrome.tabs.onActivated.addListener(activeInfo => updateExtension(activeInfo));
async function updateExtension(activeInfo) {
    try {
        chrome.tabs.get(activeInfo.tabId, function (tab) {
            chrome.action.setIcon({
                path: needEnableCopy(tab.url) ? "icons/icon24.png" : "icons/icon24-disable.png",
                tabId: activeInfo.tabId
            })
        })
    } catch (error) {
        if (error == "Error: Tabs cannot be edited right now (user may be dragging a tab).") {
            setTimeout(() => updateExtension(activeInfo), 50)
        }
    }
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status == "complete") {
        if (needEnableCopy(changeInfo.url || tab.url)) {
            script.target.tabId = tab.id;
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, function (tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    greeting: "hello"
                }, function (response) {})
            });
            chrome.action.setIcon({
                path: "icons/icon24.png",
                tabId: tab.id
            })
        } else {}
    }
});

chrome.action.onClicked.addListener(function (tab) {
    var url = tab.url;
    if (url && url.substr(0, 4) == "http") {
        var result = domain_pattern.exec(url);
        if (result && result[1] in domains_map) {
            script.target.tabId = tab.id;
            removeDomain(result[1]);
            chrome.action.setIcon({
                path: "icons/icon24-disable.png",
                tabId: tab.id
            });
            return
        }
        chrome.windows.getAll({
            populate: true
        }, function (windows) {
            for (var i = 0; i < windows.length; ++i) {
                var tabs = windows[i].tabs;
                var length = tabs.length;
                var domain = result[1];
                for (j = 0; j < length; ++j) {
                    var tab = tabs[j];
                    var url = tab.url;
                    if (url && url.substr(0, 4) == "http") {
                        var result2 = domain_pattern.exec(url);
                        if (result2 && result2[1] == domain) {
                            script.target.tabId = tab.id;
                            chrome.tabs.query({
                                active: true,
                                currentWindow: true
                            }, function (tabs) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    greeting: "hello"
                                }, function (response) {})
                            })
                        }
                    }
                }
            }
        });
        //console.log(result[1]);
        addDomain(result[1])
    } else {
        script.target.tabId = tab.id
    }
    chrome.action.setIcon({
        path: "icons/icon24.png",
        tabId: tab.id
    })
});

