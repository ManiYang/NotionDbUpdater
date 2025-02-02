import assert = require("assert")

import { PropertyValue } from "../types";


export function plainTextToTitleValue(plainText: string) {
    return {
        title: [
            {
                text: {
                    content: plainText
                }
            }
        ]
    }
}

function plainTextToRichTextValue(plainText: string) {
    return {
        rich_text: [
            {
                text: {
                    content: plainText
                }
            }
        ]
    }
}

export function convertToNotionPropertyValue(value: PropertyValue, isSelectType: boolean = false) {
    if (typeof value === 'boolean') {
        return { checkbox: value };

    } else if (typeof value === 'number') {
        return { number: value };

    } else if (typeof value === 'string') {
        if (isSelectType) {
            return {
                select: {
                    name: value
                }
            };
        } else {
            return plainTextToRichTextValue(value);
        }
        
    } else {
        console.error(`value is of type ${typeof value}`);
        assert(false); // case not implemented
    }
}

export function interpretNotionPropertyValue(obj: {[key: string]: any}): PropertyValue | null {
    if (obj.type === 'rich_text' || obj.type === 'title') {
        const richTextObjects: Array<any> 
            = (obj.type === 'rich_text') ? obj.rich_text : obj.title;

        let result = "";
        for (const richText of richTextObjects) {
            result += richText.plain_text;
        }
        return result;

    } else if (obj.type === 'select') {
        return obj.select.name;

    } else if (obj.type === 'checkbox') {
        return obj.checkbox;

    } else if (obj.type === 'number') {
        return obj.number;

    } else {
        console.error(`Notion property type ${obj.type} is not supported`);
        return null;
    }
}

/**
 * @param obj 
 * @returns array of page IDs
 */
export function interpretNotionRelationValue(obj: {[key: string]: any}): Array<string> | null {
    if (obj.type !== "relation")
        return null;

    let result: Array<string> = [];
    for (const item of obj.relation) 
        result.push(item.id);
    return result;
}
