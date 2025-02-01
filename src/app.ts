const assert = require("assert")

const path = require("path");

import { appConfig } from "../app-config"
import { ItemTypeSetting } from "./app-config-types"
import { DbRecord, PropertyValue, DbRecordsMap } from "./types";
import { InputItem, funcReadInputFile, getDbRecordFromInputItem } from "./input-file"
import { notion, getDatabaseInfo, dumpDb } from "./notion-databases"
import { plainTextToTitleValue, convertToNotionPropertyValue } from "./utilities/notion-api-util"
import { setsDifference, setsIntersection } from "./utilities/sets-util"


function haveTheSameNonRelationPropertiesAndValues(record1: DbRecord, record2: DbRecord): boolean {
    const properties1: {[key: string]: PropertyValue} = record1.properties;
    const properties2: {[key: string]: PropertyValue} = record2.properties;

    if (Object.keys(properties1).length !== Object.keys(properties2).length)
        return false;

    for (const propertyName in properties1) {
        if (!(propertyName in properties2))
            return false;
    }

    for (const propertyName in properties1) {
        if (properties1[propertyName] !== properties2[propertyName])
            return false;
    }

    return true;
}


/**
 * @param itemTypeSetting 
 * @returns is successful?
 */
async function updateNonRelationProperties(itemTypeSetting: ItemTypeSetting): Promise<boolean> {
    console.log(`---- item type: ${itemTypeSetting.itemType} ----`)
    
    // read input file
    console.log(`reading input file "${itemTypeSetting.inputFile.fileName}"`)
    const inputFilePath: string = path.join(
        appConfig.inputFileDir, itemTypeSetting.inputFile.fileName);
    const inputData: Array<InputItem> | null = await funcReadInputFile(inputFilePath);
    if (inputData === null)
        return false;

    // convert input data to DB records (without pageId)
    let newDbData: DbRecordsMap = {};
    for (const item of inputData) {
        const record: DbRecord | null = getDbRecordFromInputItem(
            item, 
            itemTypeSetting.inputFile, 
            itemTypeSetting.propertyNames,
            itemTypeSetting.relations
        );
        if (record === null) 
            return false;

        newDbData[record.itemId] = record;
    }

    // get DB's column names and types
    console.log("getting database info");

    const [dbTitle, columnNameToType] = await getDatabaseInfo(
        itemTypeSetting.notionDatabase.databaseID);

    let propertiesOfSelectType: Set<string> = new Set();
    for (const propertyName of itemTypeSetting.propertyNames) {
        if (!(propertyName in columnNameToType)) {
            console.error(`column \"${propertyName}\" not found in DB`);
            return false;
        }
        if (columnNameToType[propertyName] === "select")
            propertiesOfSelectType.add(propertyName);
    }

    // dump DB 
    console.log(`querying database "${dbTitle}"`);

    const oldDbData: DbRecordsMap | null = await dumpDb(
        itemTypeSetting.notionDatabase, itemTypeSetting.propertyNames, itemTypeSetting.relations); 
    if (oldDbData === null)
        return;

    // determine pages to create, remove, update
    const oldItemIds = new Set(Object.keys(oldDbData));
    const newItemIds = new Set(Object.keys(newDbData));

    const itemIdsToRemove = setsDifference(oldItemIds, newItemIds);
    const itemIdsToCreate = setsDifference(newItemIds, oldItemIds);

    let itemIdsToUpdate: Set<string> = new Set();
    const commonItemIds = setsIntersection(oldItemIds, newItemIds);
    for (const itemId of commonItemIds) {
        if (oldDbData[itemId].pageName !== newDbData[itemId].pageName) 
            itemIdsToUpdate.add(itemId);
        else if (!haveTheSameNonRelationPropertiesAndValues(oldDbData[itemId], newDbData[itemId]))
            itemIdsToUpdate.add(itemId);
    }

    // create pages
    for (const itemId of itemIdsToCreate) {
        const record: DbRecord = newDbData[itemId];

        let properties = {}
        for (const propertyName in record.properties) {
            const isSelectType = propertiesOfSelectType.has(propertyName);
            const value = convertToNotionPropertyValue(record.properties[propertyName], isSelectType)
            properties[propertyName] = value;
        }

        console.log(
            `create page: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        const response = await notion.pages.create({
            parent: {
                "database_id": itemTypeSetting.notionDatabase.databaseID
            },
            properties: {
                Name: plainTextToTitleValue(record.pageName),
                [itemTypeSetting.notionDatabase.propertyNameForItemId]: 
                    convertToNotionPropertyValue(record.itemId),
                ...properties
            }
        });

        // set pageId
        newDbData[itemId].pageId = response.id;
    }

    // remove pages
    for (const itemId of itemIdsToRemove) {
        const record: DbRecord = oldDbData[itemId];
        const pageId = record.pageId;
        assert(pageId !== undefined);

        console.log(
            `move page to trash: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        await notion.pages.update({
            page_id: pageId,
            in_trash: true
        });
    }

    // update pages
    for (const itemId of itemIdsToUpdate) {
        const pageId = oldDbData[itemId].pageId;
        assert(pageId !== undefined);

        //
        const record: DbRecord = newDbData[itemId];

        let newProperties = {}
        for (const propertyName in record.properties) {
            const isSelectType = propertiesOfSelectType.has(propertyName);
            const value = convertToNotionPropertyValue(record.properties[propertyName], isSelectType)
            newProperties[propertyName] = value;
        }

        console.log(
            `update page: itemId=${record.itemId}, pageName=\"${record.pageName}\"`);
        await notion.pages.update({
            page_id: pageId,
            properties: {
                Name: plainTextToTitleValue(record.pageName),
                ...newProperties
            }
        });

        // set pageId
        newDbData[itemId].pageId = pageId;
    }

    return true;
}


async function main(): Promise<number> {
    for (const itemTypeSetting of appConfig.itemTypes) {
        const ok: boolean = await updateNonRelationProperties(itemTypeSetting);
        if (!ok) 
            return 1;
    }
}


(async () => {
    process.exitCode = await main();
})()
