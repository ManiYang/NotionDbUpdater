const { Client } = require("@notionhq/client");
require("dotenv").config();

import { NotionDatabaseSetting, RelationSetting } from "./app-config-types";
import { interpretNotionPropertyValue, interpretNotionRelationValue } from "./utilities/notion-api-util"
import { DbRecord, PropertyValue, RelationValue, DbRecordsMap } from "./types";

export const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});


/**
 * @param dbId 
 * @returns (db-title, property-name-to-type)
 */
export async function getDatabaseInfo(
    dbId: string
): Promise<[string, {[key: string]: string}]> {
    const response = await notion.databases.retrieve({ database_id: dbId });

    let dbTitle: string = "";
    for (const richTextObj of response.title) 
        dbTitle += richTextObj.plain_text;


    let propertyNameToType: {[key: string]: string} = {};
    for (const propertyName in response.properties) 
        propertyNameToType[propertyName] = response.properties[propertyName].type;
    return [dbTitle, propertyNameToType];
}


export async function dumpDb(
    notionDbSetting: NotionDatabaseSetting,
    propertyNames: Array<string>,
    relationsSetting: Array<RelationSetting>
): Promise<DbRecordsMap | null> {
    const queryResponse = await notion.databases.query({
        database_id: notionDbSetting.databaseID
    });

    let result: DbRecordsMap = {}
    for (const page of (queryResponse.results ?? [])) {
        // item ID
        const itemIdValue = page.properties[notionDbSetting.propertyNameForItemId];
        if (itemIdValue === undefined) {
            console.error(
                `Notion DB does not have property ${notionDbSetting.propertyNameForItemId}`);
            return null;
        }
        const itemId: PropertyValue | null = interpretNotionPropertyValue(itemIdValue);
        if (itemId === null)
            return null;
        if (typeof itemId !== "number") {
            console.error(
                `a row in Notion DB does not have value of number type `
                + `for property ${notionDbSetting.propertyNameForItemId}`);
            return null;
        }

        // page Name
        const nameValue = page.properties.Name;
        if (nameValue === undefined) {
            console.error("Notion DB does not have property Name");
            return null;
        }
        const pageName: PropertyValue | null = interpretNotionPropertyValue(nameValue);
        if (pageName === null)
            return null;
        if (typeof pageName !== "string") {
            console.error(
                "a row in Notion DB does not have a value for property Name that "
                + "is interpreted as a string");
            return null;
        }

        // page ID
        const pageId: string = page.id;

        // properties
        let properties: {[key: string]: PropertyValue} = {}
        for (const propertyName in page.properties) {
            if (!propertyNames.includes(propertyName)) 
                continue;

            const value: PropertyValue | null 
                = interpretNotionPropertyValue(page.properties[propertyName]);
            if (value === null) 
                return null;

            properties[propertyName] = value;
        }

        // relations
        let relations: {[key: string]: Array<RelationValue>} = {};
        for (const relationSetting of relationsSetting) {
            if (!(relationSetting.propertyName in page.properties)) 
                continue;
    
            const pageIds: Array<string> | null = interpretNotionRelationValue(
                page.properties[relationSetting.propertyName])
            if (pageIds === null)
                return null;

            let relationValues: Array<RelationValue> = []
            for (const pageId of pageIds) 
                relationValues.push({ pageId: pageId });
    
            relations[relationSetting.propertyName] = relationValues;
        }
        
        //
        const record: DbRecord = {
            itemId,
            pageId,
            pageName,
            properties,
            relationProperties: relations
        }
        result[itemId] = record;
    }

    return result;
}
