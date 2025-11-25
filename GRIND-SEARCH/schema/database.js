const mongoose = require("mongoose");
// const config = require("../config/db.json");
mongoose.pluralize(null);
const Schema = mongoose.Schema;
const dbConfig = require("../dbConfig.json");
const QuerySchema = new Schema(
  {
    email: String,
    password: String,
    cookies: {
      account: String,
      bing: String,
      rewards: String,
      All: String,
    },
    status: {
      good: Boolean,
      locked: Boolean,
      suspended: Boolean,
      needReAuth: Boolean,
      error: Boolean,
      other: String,
    },
    alt: {
      email: String,
      pass: String,
      done: Boolean,
    },
    runnning: {
      date: String,
      punch: Boolean,
      search: Boolean,
      auth: Boolean,
    },
  },
  {versionKey: false},
  {supressReservedKeysWarning: true}
);

const QueryModel = mongoose.model(dbConfig.collection, QuerySchema);
module.exports = QueryModel;

// const mongoose = require("mongoose");
// mongoose.pluralize(null);
// const Schema = mongoose.Schema;
// const dbConfig = require("../dbconfig.json");
// const QuerySchema = new Schema(
//   {
//     token: String,
//     email: String,
//     password: String,
//     s: String,
//     point: Number,
//     setup: Boolean,
//     error: String,
//     cookies: {
//       msn: String,
//       bing: String,
//       rewards: String,
//       All: String,
//     },
//     MSN: {
//       m: String, // running || stop
//       LastDate:String,
//     },
//     lastGrindDate: String,
//     lastPunchDate: String,
//     p: String,
//   },
//   { versionKey: false },
//   { supressReservedKeysWarning: true }
// );

// const QueryModel = mongoose.model(dbConfig.collection, QuerySchema);
// module.exports = QueryModel;
