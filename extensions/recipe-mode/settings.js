const form = document.getElementById("credentials");
const input = document.getElementById("key");
const status = document.getElementById("status");

await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const { skimKey } = await chrome.storage.local.get("skimKey");
if (skimKey) status.textContent = "An API key is saved.";

form.onsubmit = async event => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) return;
  await chrome.storage.local.set({ skimKey: key });
  input.value = "";
  status.textContent = "API key saved. Return to the recipe tab and try again.";
};
