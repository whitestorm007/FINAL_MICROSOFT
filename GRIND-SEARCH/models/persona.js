// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;

// const PersonaSchema = new Schema({

//     name: String,
//     profession: String,
//     interests: [String],
//     dailyRoutine: String,
//     techProfile: {
//         pc: {
//             os: String,
//             browser: String
//         },
//         mobile: {
//             os: String,
//             browser: String
//         }
//     }

//     // name: { type: String, required: true }, // e.g., "Denver Graphic Designer"

//     // profession: String,
//     // interests: [String],
//     // // Defines the windows of time the user is active
//     // activityWindows: [{
//     //     name: String, // e.g., "Morning Commute", "Lunch Break", "Evening Browsing"
//     //     startTime: String, // "HH:mm" format, e.g., "08:30"
//     //     endTime: String, // "HH:mm" format, e.g., "09:30"
//     //     device: { type: String, enum: ['PC', 'MOBILE'] }
//     // }],
//     // // Human-like delays and interaction chances
//     // behaviorProfile: {
//     //     timeBetweenSearchesMs: { min: Number, max: Number }, // e.g., { min: 15000, max: 45000 }
//     //     clickThroughChance: { type: Number, default: 0.15 }, // 15% chance to click a result
//     //     pageViewDurationMs: { min: Number, max: Number } // e.g., { min: 30000, max: 60000 }
//     // },
//     // // Device profile for User-Agent strings
//     // techProfile: {
//     //     pc: { os: String, browser: String },
//     //     mobile: { os: String, browser: String }
//     // }
// }, { timestamps: true });

// const PersonaModel = mongoose.model("Persona", PersonaSchema);
// module.exports = PersonaModel;

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PersonaSchema = new Schema({
    name: String,
    profession: String,
    interests: [String],
    dailyRoutine: String,
    techProfile: {
        pc: { os: String, browser: String },
        mobile: { os: String, browser: String }
    },
    // Add this field to track assignment status
    isAssigned: { type: Boolean, default: false, index: true } 
}, { timestamps: true });

const PersonaModel = mongoose.model("Persona", PersonaSchema);
module.exports = PersonaModel;