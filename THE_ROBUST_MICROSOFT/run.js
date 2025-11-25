require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const RewardsAccountModel = require("./model/db");
const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/default_db";
const { MicrosoftAuth } = require("./microsoft-auth");
// MongoDB connection
const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("MongoDB connected successfully");

        await main();
    } catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1);
    }
};

async function main() {
    try {
        const accounts = await RewardsAccountModel.findOne({
            isEnabled: true,
            accountStatus: "ACTIVE",
            currentTask: { $ne: "NONE" },
        });

        if (!accounts || accounts.length === 0) {
            console.log("! No account found");
            return true;
        }

        var TaskStatus;
        switch (accounts.currentTask) {
            case "AUTH_FULL":
                TaskStatus = await AUTH_FULL_SCRATCH(accounts)
                break;
            case "AUTH":
                TaskStatus = await BasicLoginAccount(accounts.email, accounts.password)
                break;
            case "ALT":
                break;
            case "RE_AUTH":
                break;
            default:
                break;
        }
        // var mainAccount = BasicLoginAccount(accounts.email, accounts.password)
        // var RecAccount = BasicLoginAccount(email, password)

        // console.log('Email:', accounts);
    } catch (error) {
        console.error("Error in main function:", error);
        throw error;
    }
}

connectDB();

async function BasicLoginAccount(email, password) {
    return new Promise(async (resolve, reject) => {
        try {
            const mainAuth = new MicrosoftAuth({
                email: email,
                password: password,
            });

            console.log("🔑 Authenticating main account...");
            const mainResult = await mainAuth.login([
                "ALL",
                "OUTLOOK",
                "REWARDS",
                "BING",
            ]);

            if (mainResult.success) {
                var Jar = await mainAuth.session.exportCookieJar();

                await RewardsAccountModel.updateOne(
                    { email },
                    { $set: { cookieJar: Jar, currentTask: "ALT" } }
                );
                resolve({ success: true, cookies: Jar });

            } else {
                resolve({ success: false, msg: mainResult.error });

            }
        } catch (error) {
            resolve({ success: false, msg: error });
        }
    });
}

async function AUTH_FULL_SCRATCH(account) {
    return new Promise(async (resolve, reject) => {
        var RecAccount = await RewardsAccountModel.findOne({ email: account.recoveryAccount.email })
        if (!RecAccount) {
            console.log("!recoveryAccount Not Found");
            return true
        };

         // check for if account has cookieJar , and it's valid 
         // do BasicLoginAccount on both account  account.email account.password , account.recoveryAccount.email , account.recoveryAccount.password
        //




    });
}