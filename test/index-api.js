const mongoose = require('mongoose');
const fs = require('fs');
const yaml = require('yaml');
var swaggeringMongoose = require('./../lib/index');
const descriptor = yaml.parse(fs.readFileSync('./test/api.yaml', 'utf8'));
const { models, schemas } = swaggeringMongoose.compile(JSON.stringify(descriptor));
  
  // Register the models
  Object.entries(models).forEach(([modelName, model]) => {
    mongoose.model(modelName, model.schema);
  });