/* eslint dot-notation: 0 */
'use strict';
var forEach = require('foreach');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var path = require('path');

var MONGOOSE_SPECIFIC = 'x-swaggering-mongoose';
var ALLOWED_TYPES = {
  'integer': Number,
  'long': Number,
  'float': Number,
  'double': Number,
  'password': String,
  'boolean': Boolean,
  'date': Date,
  'dateTime': Date,
  // special case
  'string': true,
  'number': true,
  'array': true,
  'object': true
};
var X_SWAGGERING_MONGOOSE = {
  schemaOptions: {},
  additionalProperties: {},
  excludeSchema: {},
  documentIndex: {},
};
var validators = {};

// object mixin
var extend = function( destination, source ) {
  for ( var k in source ) {
    if ( source.hasOwnProperty( k ) ) {
      destination[ k ] = source[ k ];
    }
  }
  return destination;
};

var convertToJSON = function(spec) {
  var swaggerJSON = {};
  var type = typeof (spec);
  switch (type) {
    case 'object':
      if (spec instanceof Buffer) {
        swaggerJSON = JSON.parse(spec);
      } else {
        swaggerJSON = spec;
      }
      break;
    case 'string':
      swaggerJSON = JSON.parse(spec);
      break;
    default:
      throw new Error('Unknown or invalid spec object');
  }
  return swaggerJSON;
};

var isSimpleSchema = function(schema) {
  return schema.type && isAllowedType(schema.type);
};

var isAllowedType = function (type) {
  return ALLOWED_TYPES.indexOf(type) != -1;
};

var hasPropertyRef = function(property) {
  return property['$ref'] || ((property['type'] === 'array') && (property['items']['$ref']));
};

var fillRequired = function(object, key, template) {
  if (template.indexOf(key) >= 0 ) {
    if (object[key].type) {
      object[key].required = true;
    }
  }
};

var isMongooseProperty = function(property) {
  return !!property[MONGOOSE_SPECIFIC];
};

var isMongooseArray = function(property) {
  return property.items && property.items[MONGOOSE_SPECIFIC];
};

var getMongooseSpecific = function(props, property) {
  var mongooseSpecific = property[MONGOOSE_SPECIFIC];
  var ref = property.$ref;

  if (!mongooseSpecific && isMongooseArray(property)) {
    mongooseSpecific = property.items[MONGOOSE_SPECIFIC];
    ref = property.items.$ref;
  }

  if (!mongooseSpecific) {
    return props;
  }

  if (mongooseSpecific.type === 'ObjectId' && !mongooseSpecific.ref && ref) {
    mongooseSpecific.type = Schema.Types.ObjectId;
    mongooseSpecific.ref = ref.replace('#/definitions/', '');
    mongooseSpecific.ref = mongooseSpecific.ref.replace('#/components/schemas/', '');
  //} else if (mongooseSpecific.validator) {
  //    var validator = validators[mongooseSpecific.validator];
  //    mongooseSpecific = extend({validate: validator}, mongooseSpecific);
  //    delete mongooseSpecific[MONGOOSE_SPECIFIC];
  } else if ( mongooseSpecific.type ) {
    if (mongooseSpecific.type === Schema.Types.ObjectId) {
      return mongooseSpecific;
    }
    if (!Schema.Types[mongooseSpecific.type]) {
      throw new Error('Unrecognised ' + MONGOOSE_SPECIFIC + ' type: ' + mongooseSpecific.type + ' at: ' + JSON.stringify(property) );
    }
    mongooseSpecific.type = Schema.Types[mongooseSpecific.type];
  //} else {
  //  mongooseSpecific = extend(property, mongooseSpecific);
  //  delete mongooseSpecific[MONGOOSE_SPECIFIC];
  //  if (isSimpleSchema(mongooseSpecific)) {
  //    mongooseSpecific.type = propertyMap(mongooseSpecific);
  //  }
  }
  return mongooseSpecific;
};

var isMongodbReserved = function(fieldKey) {
  return fieldKey === '_id' || fieldKey === '__v';
};

var propertyMap = function(property) {
  var type = ALLOWED_TYPES[property.type];
  if (!!type && type !== true) {
    return type;
  }
  switch (property.type) {
    case 'number':
      switch (property.format) {
        case 'integer':
        case 'long':
        case 'float':
        case 'double':
          return Number;
        default:
          throw new Error('Unrecognised schema format: ' + property.format);
      }
    case 'string':
      if (property.format === 'date-time' || property.format === 'date') {
        return Date;
      }
      return String;
    case 'array':
      return [propertyMap(property.items)];
    case 'object':
      return getSchema(property);
    default:
      throw new Error('Unrecognised property type: ' + property.type + ' at: ' + JSON.stringify(property));
  }
};



var getSchema = function(fullObject, objectName, definitions) {
  var props = {};
  var required = fullObject.required || [];
  var object = fullObject['properties'] ? fullObject['properties'] : fullObject;
  if(!fullObject['properties'] && !isMongooseProperty(fullObject)){
    return Schema.Types.Mixed;
  }

  forEach(object, function(property, key) {
    var schemaProperty = getSchemaProperty(property, key, required, objectName, object, definitions);
    extend(schemaProperty, props);
  });

  return props;
};

var getSchemaProperty = function(property, key, required, objectName, object, definitions) {
  var processRef = function(property, key) {
    var refRegExp = /^#\/(?:definitions|components\/schemas)\/(\w*)$/;
    var refString = property['$ref'] ? property['$ref'] : property['items']['$ref'];
    var refDefinition = refString.match(refRegExp);
    if (!refDefinition) {
      throw new Error('Unrecognised reference "' + refString + '" at: ' + JSON.stringify(property));
    }
    var propType = refDefinition[1];
    if (propType !== objectName) {
      // NOT circular reference
      var schema = getSchema(definitions[propType]['properties'] ? definitions[propType]['properties'] : definitions[propType], propType, definitions);
      props[key] = property['items'] || object.type === 'array' ? [schema] : schema;
    } else {
      // circular reference
      props[key] = {
        type: Schema.Types.ObjectId,
        ref: objectName
      };
    }
  };

  let props ={};
  if (isMongodbReserved(key) === true) {
    return;
  }

  try {
    if (isMongooseArray(property)) {
      props[key] = [getMongooseSpecific(props, property)];
    } else if (hasPropertyRef(property)) {
      processRef(property, key);
    } else if (property.type) {
      if (property.type !== 'object') {
        props[key] = {
          type: propertyMap(property)
        };
      } else {
        props[key] = getSchema(property, key, definitions);
      }
      if(!!property.default) props[key].default = property.default;
    } else if (isSimpleSchema(object)) {
      props = {
        type: propertyMap(object)
      };
    }

    fillRequired(props, key, required);

    if (isMongooseProperty(property)) {
      props[key] = extend( props[key] || {}, getMongooseSpecific(props, property));
    }
    return props;
  } catch (ex) {
    throw new Error('Exception processing key "' + key + '" at: ' + JSON.stringify(property) + ':\n' + ex.stack + '\n');
  }
}


var processMongooseDefinition = function(key, customOptions) {
  if (customOptions) {
    if (customOptions['schema-options']) {
      X_SWAGGERING_MONGOOSE.schemaOptions[key] = customOptions['schema-options'];
    }
    if (customOptions['exclude-schema']) {
      X_SWAGGERING_MONGOOSE.excludeSchema[key] = customOptions['exclude-schema'];
    }
    if (customOptions['additional-properties']) {
      X_SWAGGERING_MONGOOSE.additionalProperties[key] = customOptions['additional-properties'];
    }
    if (customOptions['index']) {
      X_SWAGGERING_MONGOOSE.documentIndex[key] = customOptions['index'];
    }
    if (customOptions['validators']) {
      var validatorsDirectory = path.resolve(process.cwd(),customOptions['validators'])
      validators = require(validatorsDirectory)
    }

  }
};
var applyExtraDefinitions = function (definitions, _extraDefinitions) {
  if (_extraDefinitions) {

    //TODO: check for string or object assume object for now.
    // var extraDefinitions = JSON.parse(_extraDefinitions);
    var mongooseProperty = MONGOOSE_SPECIFIC;

    //remove default object from extra, we're going to handle that seperately
    var defaultDefs;
    if (!_extraDefinitions.default) {
      defaultDefs = null;
    } else {
      defaultDefs = _extraDefinitions.default
      delete _extraDefinitions.default;
      forEach(definitions, function (val,key){
        //lets add that default to everything.
        val[mongooseProperty] = defaultDefs
      });
    }

    var extraDefinitions = _extraDefinitions;
    forEach(extraDefinitions, function (val, key) {
      definitions[key][mongooseProperty] = val
    });

  }
};

var m = {};

m.getDefinitions = function(spec, _extraDefinitions=null) {
  if (!spec) {
    throw new Error('Swagger spec not supplied');
  }
  var swaggerJSON = convertToJSON(spec);
  let definitions =swaggerJSON['definitions'] || swaggerJSON['components']['schemas'];
  if(_extraDefinitions){
    applyExtraDefinitions(definitions, _extraDefinitions);
  }
  return definitions;
};

var processAdditionalProperties = function(additionalProperties, objectName) {
  var props = {};
  forEach(additionalProperties, function(property, key) {
    var modifiedProperty = {};
    modifiedProperty[MONGOOSE_SPECIFIC] = property;
    props = extend(getSchemaProperty(modifiedProperty, key, property.required, objectName), props);
  });
  return props;
};

m.getSchemas = function(definitions) {
  if (!definitions) {
    throw new Error('Definitions not supplied');
  }
  var schemas = {};
  forEach(definitions, function(definition, key) {
    if (definition[MONGOOSE_SPECIFIC]) {
      processMongooseDefinition(key, definition[MONGOOSE_SPECIFIC]);
    }
    var excludedSchema = X_SWAGGERING_MONGOOSE.excludeSchema;
    if (excludedSchema[key]) {
      return;
    }
    var schemaObj = getSchema(definition, key, definitions);
    var schemaOpts = definition[MONGOOSE_SPECIFIC];
    schemas[key] = new mongoose.Schema(schemaObj, schemaOpts);
    var options = X_SWAGGERING_MONGOOSE.schemaOptions;
    var documentIndex = X_SWAGGERING_MONGOOSE.documentIndex[key];
    if (options) {
      options = extend(options[key], options);
    }
    if (typeof excludedSchema === 'object') {
      excludedSchema = excludedSchema[MONGOOSE_SPECIFIC] || excludedSchema[key];
    }
    if (object && !excludedSchema) {
      var additionalProperties = extend(X_SWAGGERING_MONGOOSE.additionalProperties[key], X_SWAGGERING_MONGOOSE.additionalProperties[MONGOOSE_SPECIFIC]);
      additionalProperties = processAdditionalProperties(additionalProperties, key);
      object = extend(additionalProperties, object);
      var schema = new mongoose.Schema(object, options);
      processDocumentIndex(schema, documentIndex)
      schemas[key] = schema
    }
   
  });
  return schemas;
};

m.getModels = function(schemas) {
  if (!schemas) {
    throw new Error('Schemas not supplied');
  }
  var models = {};
  forEach(schemas, function(schema, key) {
    models[key] = mongoose.model(key, schema);
  });
  return models;
};

m.compile = function(spec, _extraDefinitions) {
  var definitions = m.getDefinitions(spec, _extraDefinitions);
  var schemas = m.getSchemas(definitions);
  var models = m.getModels(schemas);

  return {
    schemas: schemas,
    models: models
  };
};

module.exports = m;