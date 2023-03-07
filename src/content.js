chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.greeting === "hello") {
        const s = document.createElement("script");
        s.setAttribute("src", "chrome-extension://ggibadcfmilllfefhfbpifbamabehfdd/enable.js"); // chrome extension store
        //s.setAttribute("src", "chrome-extension://ohkfmkndnoojnbdmkcnjphldllfggflo/enable.js"); // develop
        document.documentElement.appendChild(s)
    }
});