# Quick Deploy Guide - Show Your Boss in 5 Minutes! 🚀

## Prerequisites (2 minutes)
1. Have your `.env` file ready with all credentials
2. Create a GitHub account (if you don't have one) at https://github.com
3. Create a Vercel account at https://vercel.com (sign up with GitHub - it's free!)

## Step 1: Push to GitHub (2 minutes)

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Employee Management System"

# Create a new repository on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/employee-management.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy to Vercel (3 minutes)

1. Go to https://vercel.com
2. Click **"Add New Project"**
3. **Import** your GitHub repository
4. Vercel will auto-detect Next.js - just click **"Deploy"**

**IMPORTANT**: The first deploy will fail because environment variables aren't set yet - that's normal!

## Step 3: Add Environment Variables (2 minutes)

1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add each variable from your `.env` file:

**Required Variables:**
```
NEXT_PUBLIC_SUPABASE_URL=your_value_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_value_here
SUPABASE_SERVICE_ROLE_KEY=your_value_here
AZURE_CLIENT_ID=your_value_here
AZURE_CLIENT_SECRET=your_value_here
AZURE_TENANT_ID=your_value_here
NINJA_CLIENT_ID=your_value_here
NINJA_CLIENT_SECRET=your_value_here
NINJA_REGION=us
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
SYNC_CRON_SECRET=your_value_here
```

3. For `NEXT_PUBLIC_APP_URL`, use your Vercel URL (e.g., `https://employee-management-abc123.vercel.app`)
4. Click **"Save"** for each variable

## Step 4: Redeploy (1 minute)

1. Go to **Deployments** tab
2. Click the three dots (**...**) on the latest deployment
3. Click **"Redeploy"**
4. Wait ~1-2 minutes for build to complete

## Step 5: Run Initial Sync (2 minutes)

1. Visit your Vercel URL (e.g., `https://employee-management-abc123.vercel.app`)
2. Navigate to the **Sync** page
3. Click **"Sync All Systems"** button
4. Wait for sync to complete (may take 5-10 minutes depending on data size)

## 🎉 Done! Share with Your Boss

Your deployed URL: `https://your-project.vercel.app`

**What your boss can see:**
- ✅ Live employee directory
- ✅ Device tracking
- ✅ Filtering and search
- ✅ Employee details with devices
- ✅ Professional, modern UI

---

## 📱 Demo Tips

**Best pages to show:**
1. **Home** - Shows all features at a glance
2. **Employees** - Show filtering (by department, office, status)
3. **Employee Detail** - Pick an employee with devices to show full integration
4. **Devices** - Show all devices from NinjaOne
5. **Sync Status** - Show automated sync logs

**Things to highlight:**
- "This syncs automatically with Azure Entra ID every day"
- "It pulls device data from NinjaOne automatically"
- "We can filter employees by department, office, or status"
- "Each employee shows their assigned devices and software"

---

## ⚠️ Troubleshooting

**Build fails?**
- Check that all environment variables are added
- Make sure there are no syntax errors in your .env values
- Redeploy after adding variables

**Sync fails?**
- Verify Azure permissions are granted (admin consent)
- Check NinjaOne API credentials
- Look at sync logs for specific errors

**Data not showing?**
- Run the initial sync first (Sync page → "Sync All Systems")
- Check Supabase database has the schema installed
- Verify API credentials in environment variables

---

## 🔒 Security Note

This is a demo deployment. For production:
- Set up proper authentication
- Review all environment variables
- Set up monitoring and alerts
- Configure custom domain


