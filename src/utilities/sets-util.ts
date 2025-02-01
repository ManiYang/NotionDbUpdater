
export function setsDifference(setA: Set<any>, setB: Set<any>): Set<any> {
    let result: Set<any> = new Set(setA);
    for (const item of setB)
        result.delete(item);
    return result;
}

export function setsIntersection(setA: Set<any>, setB: Set<any>): Set<any> {
    let result: Set<any> = new Set();
    for (const item of setA) {
        if (setB.has(item))
            result.add(item);
    }
    return result;
}

export function setsUnion(setA: Set<any>, setB: Set<any>): Set<any> {
    let result: Set<any> = new Set();
    for (const item of setA) 
        result.add(item);
    for (const item of setB) 
        result.add(item);
    return result;
}
