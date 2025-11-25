const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SearchTaskSchema = new Schema({
    query: { type: String, required: true },
    executeAt: { type: Date, required: true }
}, { _id: false });



const TaskSchema = new Schema({
    // What kind of task is this?
    taskType: {
        type: String,
        enum: ['SEARCH', 'DAILY_GRIND'],
        required: true
    },
    query: String,
    device: { type: String, enum: ['PC', 'MOBILE'], required: true },
    executeAt: { type: Date, required: true },
    sessionId: { type: String, index: true }, // e.g., "weekend-hiking-plan"
    status: {
        type: String,
        enum: ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED'],
        default: 'PENDING'
    },

}, { _id: true }); // Give tasks their own ID for easier updates




const RewardsAccountSchema = new Schema(
    {
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        batchIdentifier: { type: String, required: true, index: true },
        persona: { type: Schema.Types.ObjectId, ref: 'Persona' },
        recoveryAccount: { email: String, password: String, set: Boolean },
        rewardLevel: { type: Number, default: 1 },
        pointsPerSearch: { type: Number, default: 5 },
        dailyPlan: {
            planDate: String, // e.g., "2025-10-03"
            tasks: [TaskSchema] // A single queue for all of the day's activities
        },
        dailyLimits: {
            pc: { type: Number, default: 50 },
            mobile: { type: Number, default: 30 }
        },
        searchProgress: {
            pc: { type: Number, default: 0 },
            mobile: { type: Number, default: 0 }
        },
        jobStatus: {
            type: String,
            enum: ['RUNNING', 'IDLE'],
            default: 'IDLE'
        },
        currentTask: {
            type: String,
            enum: ['AUTH_FULL', "AUTH", 'ALT', "RE_AUTH", 'NONE'],
            default: 'AUTH_FULL'
        },
        currentTaskError: {
            type: String,
            default: 'None'
        },
        assignedWorkerId: { type: String, index: true, default: null },
        proxy: {
            host: String,
            port: Number,
            username: String,
            password: String
        },
        lastSession: { type: Date },
        nextSessionEligible: { type: Date, default: () => new Date() },
        jobMessage: String,
        accountStatus: {
            type: String,
            enum: ['ACTIVE', 'LOCKED', 'SUSPENDED', "MANUAL_REVIEW"],
            default: 'ACTIVE'
        },
        cookieJar: { type: String },
        isEnabled: { type: Boolean, default: true }
    },
    {
        timestamps: true
    }
);

const RewardsAccountModel = mongoose.model("Accounts4", RewardsAccountSchema);

module.exports = RewardsAccountModel;