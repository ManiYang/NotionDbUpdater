import assert = require("assert");

let notionClient = null;

export function setNotionClient(notion) {
    assert(notionClient === null); // Notion client is already set
    notionClient = notion;
}

export function getNotionClient() {
    assert(notionClient !== null); // Notion client is not set
    return notionClient;
}
