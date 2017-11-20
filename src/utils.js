import castArray from 'lodash.castarray';
import flatMap from 'lodash.flatmap';
import forEach from 'lodash.foreach';
import isPlainObject from 'lodash.isplainobject';
import reduce from 'lodash.reduce';

const defaultArrayReplacement = [];
const defaultObjectReplacement = Object.create(null);

function reassign(collection, replacement = null) {
  if (Array.isArray(collection)) {
    const replacementArray = replacement || defaultArrayReplacement;
    collection.length = replacementArray.length;
    replacementArray.forEach((value, i) => {
      collection[i] = value;
    });
  } else if (isPlainObject(collection)) {
    const replacementObject = replacement || defaultObjectReplacement;
    forEach(collection, (value, key) => {
      if (!(key in replacementObject)) {
        delete collection[key];
      }
    });

    Object.assign(collection, replacementObject);
  }
}

export { castArray, flatMap, forEach, isPlainObject, reassign, reduce };
