chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    var extension_id = chrome.runtime.id;
    if (request.greeting === "hello") {
        const s = document.createElement("script");
        s.setAttribute("src", "chrome-extension://" + extension_id + "/enable.js");
        document.documentElement.appendChild(s)
    }
});