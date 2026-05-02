chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "openNewWindow" && message.url) {
    chrome.windows.create({ url: message.url, focused: true }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});
