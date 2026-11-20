// Clicking the toolbar icon opens the chat in its own window (or focuses it if already open).
let chatWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (chatWindowId !== null) {
    try {
      await chrome.windows.update(chatWindowId, { focused: true });
      return;
    } catch {
      chatWindowId = null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("chat.html"),
    type: "popup",
    width: 440,
    height: 860
  });
  chatWindowId = win.id;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === chatWindowId) chatWindowId = null;
});
