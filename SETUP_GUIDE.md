# Employee Management System - Complete Setup Guide

This guide walks you through every step of setting up the Employee Management System.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Supabase Configuration](#supabase-configuration)
4. [Azure Entra ID Setup](#azure-entra-id-setup)
5. [NinjaOne Setup](#ninjaone-setup)
6. [Application Configuration](#application-configuration)
7. [First Data Sync](#first-data-sync)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- [ ] Node.js 18+ installed
- [ ] npm or yarn package manager
- [ ] Access to Azure Portal with admin rights
- [ ] Supabase account (free tier works)
- [ ] NinjaOne account with API access
- [ ] Git installed (for version control)
- [ ] Code editor (VS Code recommended)

## Initial Setup

### 1. Download and Install Dependencies

```bash
# Navigate to project directory
cd employee-management

# Install dependencies
npm install

# Verify installation
npm run dev
```

If the dev server starts without errors, you're ready to proceed.

## Supabase Configuration

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign in or create an account
3. Click "New Project"
4. Fill in details:
   - **Name**: Employee Management
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to your users
5. Click "Create new project"
6. Wait for provisioning (2-3 minutes)

### Step 2: Get API Keys

1. In your project dashboard, go to **Settings** > **API**
2. Copy these values:
   - **Project URL** (example: https://abcdefg.supabase.co)
   - **anon public** key
   - **service_role** key (keep this secret!)

### Step 3: Create Database Schema

1. Go to **SQL Editor** in left sidebar
2. Click "New query"
3. Open `supabase/schema.sql` from your project
4. Copy entire contents
5. Paste into Supabase SQL editor
6. Click "Run"
7. Verify success (you should see "Success. No rows returned")

### Step 4: Verify Tables

1. Go to **Table Editor** in left sidebar
2. You should see these tables:
   - employees
   - devices
   - device_software
   - tickets
   - licenses
   - license_assignments
   - sync_logs

## Azure Entra ID Setup

### Step 1: Create App Registration

1. Sign in to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory**
3. Click **App registrations** in left sidebar
4. Click **New registration**
5. Fill in:
   - **Name**: Employee Management System
   - **Supported account types**: 
     - Select "Accounts in this organizational directory only"
   - **Redirect URI**: Leave blank for now
6. Click **Register**

### Step 2: Copy Application IDs

After registration, you'll see the Overview page:

1. Copy **Application (client) ID**
   - Example: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
   
2. Copy **Directory (tenant) ID**
   - Example: `12345678-90ab-cdef-1234-567890abcdef`

Save these values - you'll need them later.

### Step 3: Create Client Secret

1. In left sidebar, click **Certificates & secrets**
2. Click **New client secret**
3. Fill in:
   - **Description**: Employee Management System
   - **Expires**: Choose 24 months (or your preference)
4. Click **Add**
5. **IMMEDIATELY COPY THE VALUE** (you can't see it again!)
   - Example: `abc123~DEF456.GHI789_jkl012-mno345`

### Step 4: Configure API Permissions

1. In left sidebar, click **API permissions**
2. Click **Add a permission**
3. Choose **Microsoft Graph**
4. Choose **Application permissions** (not Delegated)
5. Search and add these permissions:
   - `User.Read.All`
   - `Directory.Read.All`
   - `Organization.Read.All`
6. Click **Add permissions**
7. **IMPORTANT**: Click **Grant admin consent for [your organization]**
8. Click **Yes** to confirm
9. Verify all permissions show "Granted" status

### Step 5: Verify Permissions

Your permissions should look like this:

| API/Permission Name | Type | Status |
|-------------------|------|--------|
| Microsoft Graph - User.Read.All | Application | ✅ Granted |
| Microsoft Graph - Directory.Read.All | Application | ✅ Granted |
| Microsoft Graph - Organization.Read.All | Application | ✅ Granted |

## NinjaOne Setup

### Step 1: Create API Application

1. Log into NinjaOne
2. Go to **Administration** > **Apps** > **API**
3. Click **Add** (or **New API Application**)
4. Fill in:
   - **Name**: Employee Management System
   - **Description**: Integration for employee device tracking
   - **Allowed Grant Types**: Select "Client Credentials"
5. Select scopes/permissions:
   - **Monitoring**: Read access
   - **Management**: Read access
   - **Device**: Read access
6. Click **Save**

### Step 2: Copy Credentials

After creation, you'll see:

1. **Client ID**
   - Example: `a1b2c3d4e5f6g7h8i9j0`
   
2. **Client Secret**
   - Example: `AbC123-DeF456_GhI789-JkL012`

**Copy both immediately!**

### Step 3: Determine Your Region

Check your NinjaOne URL to determine region:

| URL | Region Code |
|-----|-------------|
| app.ninjarmm.com | `us` |
| eu.ninjarmm.com | `eu` |
| oc.ninjarmm.com | `oc` |
| ca.ninjarmm.com | `ca` |

### Step 4: Test API Access

Optional but recommended - test your credentials:

```bash
# Get access token (replace placeholders)
curl -X POST "https://app.ninjarmm.com/ws/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "scope=monitoring management"
```

You should get a response with an access token.

## Application Configuration

### Step 1: Create Environment File

1. In project root, create `.env` file:

```bash
# Copy from example
cp .env.example .env
```

Or create manually with this content:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Azure Entra ID
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
AZURE_REDIRECT_URI=http://localhost:3000/api/auth/callback

# NinjaOne API
NINJA_CLIENT_ID=
NINJA_CLIENT_SECRET=
NINJA_REGION=us

# Application Settings
NEXT_PUBLIC_APP_URL=http://localhost:3000
SYNC_CRON_SECRET=
```

### Step 2: Fill in Supabase Values

From Step "Supabase Configuration":

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 3: Fill in Azure Values

From Step "Azure Entra ID Setup":

```bash
AZURE_CLIENT_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
AZURE_CLIENT_SECRET=abc123~DEF456.GHI789_jkl012-mno345
AZURE_TENANT_ID=12345678-90ab-cdef-1234-567890abcdef
```

### Step 4: Fill in NinjaOne Values

From Step "NinjaOne Setup":

```bash
NINJA_CLIENT_ID=a1b2c3d4e5f6g7h8i9j0
NINJA_CLIENT_SECRET=AbC123-DeF456_GhI789-JkL012
NINJA_REGION=us
```

### Step 5: Generate Cron Secret

Generate a secure random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and add to `.env`:

```bash
SYNC_CRON_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

### Step 6: Verify Configuration

Your complete `.env` should look like this (with your actual values):

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Azure Entra ID
AZURE_CLIENT_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
AZURE_CLIENT_SECRET=abc123~DEF456.GHI789_jkl012-mno345
AZURE_TENANT_ID=12345678-90ab-cdef-1234-567890abcdef
AZURE_REDIRECT_URI=http://localhost:3000/api/auth/callback

# NinjaOne API
NINJA_CLIENT_ID=a1b2c3d4e5f6g7h8i9j0
NINJA_CLIENT_SECRET=AbC123-DeF456_GhI789-JkL012
NINJA_REGION=us

# Application Settings
NEXT_PUBLIC_APP_URL=http://localhost:3000
SYNC_CRON_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

## First Data Sync

### Step 1: Start Development Server

```bash
npm run dev
```

Open http://localhost:3000

### Step 2: Sync Azure Entra ID

1. Navigate to **Sync** page (or go to http://localhost:3000/sync)
2. Under "Azure Entra ID Sync", click **Sync Now**
3. Wait for completion (may take 1-5 minutes depending on employee count)
4. Check for success message
5. Review sync history to see records synced

**What this does**:
- Fetches all users from Azure Entra ID
- Creates employee records in Supabase
- Updates existing employee records
- Sets employment status based on account status

### Step 3: Verify Employee Data

1. Navigate to **Employees** page
2. You should see all your employees
3. Check a few profiles to verify data accuracy
4. If data looks good, proceed to next sync

**If employees are missing**:
- Check sync history for errors
- Verify Azure permissions were granted
- Check browser console for errors

### Step 4: Sync NinjaOne

1. Return to **Sync** page
2. Under "NinjaOne Sync", click **Sync Now**
3. Wait for completion (may take longer with many devices)
4. Check for success message
5. Review sync history

**What this does**:
- Fetches all devices from NinjaOne
- Creates device records in Supabase
- Attempts to link devices to employees (via custom fields)
- Syncs installed software for each device

### Step 5: Verify Device Data

1. Navigate to **Devices** page
2. You should see all devices from NinjaOne
3. Click on an employee profile
4. Check "Devices" tab to see assigned devices
5. Verify software list appears

**If devices aren't linking to employees**:
- NinjaOne may not have employee email in custom fields
- You may need to update the sync logic in `app/api/sync/ninjaone/route.ts`
- Manual assignment may be needed in some cases

### Step 6: Test Filtering and Search

1. Go to **Employees** page
2. Try searching for an employee
3. Apply filters (department, office location, employment status)
4. Verify results are accurate

## Production Deployment

### Option 1: Deploy to Vercel (Recommended)

#### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial setup of employee management system"

# Create GitHub repo, then:
git remote add origin https://github.com/yourusername/employee-management.git
git push -u origin main
```

#### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click **Add New Project**
4. Import your GitHub repository
5. Configure:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: ./
   - **Build Command**: npm run build
   - **Output Directory**: .next

#### Step 3: Add Environment Variables

In Vercel project settings:

1. Go to **Settings** > **Environment Variables**
2. Add ALL variables from your `.env` file
3. Update these for production:
   - `NEXT_PUBLIC_APP_URL`: Your Vercel URL
   - `AZURE_REDIRECT_URI`: Update if using auth

#### Step 4: Deploy

1. Click **Deploy**
2. Wait for build to complete
3. Visit your deployment URL
4. Test all functionality

#### Step 5: Verify Cron Jobs

1. In Vercel project, go to **Settings** > **Cron Jobs**
2. You should see two cron jobs from `vercel.json`:
   - Azure Entra ID sync (daily at 2 AM)
   - NinjaOne sync (daily at 3 AM)
3. Verify they're enabled

### Option 2: Deploy to Other Platforms

For AWS, Azure, or other platforms:

1. Build the application:
```bash
npm run build
```

2. Set up Node.js hosting environment
3. Configure environment variables
4. Set up cron jobs manually (see README.md)
5. Point domain to your deployment

## Troubleshooting

### Common Issues

#### "Failed to sync Entra ID data"

**Possible causes**:
- Azure credentials incorrect
- Permissions not granted
- Admin consent not given

**Solutions**:
1. Verify credentials in `.env`
2. Check Azure App Registration permissions
3. Grant admin consent again
4. Check sync logs for detailed error

#### "No devices showing for employees"

**Possible causes**:
- NinjaOne custom field mapping
- Devices not assigned in NinjaOne
- Email mismatch between systems

**Solutions**:
1. Check NinjaOne custom fields
2. Update sync logic if needed
3. Verify employee emails match exactly
4. Manual device assignment may be needed

#### "Supabase connection failed"

**Possible causes**:
- Incorrect Supabase URL or keys
- Schema not created
- Network/firewall issues

**Solutions**:
1. Verify credentials in `.env`
2. Re-run schema.sql in Supabase
3. Check Supabase project is active
4. Test connection in Supabase dashboard

#### "Sync takes too long / times out"

**Possible causes**:
- Large number of employees/devices
- API rate limiting
- Network latency

**Solutions**:
1. Run syncs during off-hours
2. Check API rate limits
3. Consider pagination improvements
4. Monitor sync logs for bottlenecks

### Getting Help

If you encounter issues:

1. **Check Logs**:
   - Sync logs in the Sync page
   - Supabase logs in dashboard
   - Browser console (F12)
   - Vercel logs (if deployed)

2. **Verify Configuration**:
   - Double-check all credentials
   - Test API access independently
   - Verify network connectivity

3. **Review Documentation**:
   - README.md for feature details
   - API documentation for integrations
   - Supabase docs for database issues

## Next Steps

After successful setup:

1. **License Management**:
   - Add software licenses
   - Assign licenses to employees
   - Set up expiration alerts

2. **Customization**:
   - Adjust sync schedules
   - Customize UI colors/branding
   - Add custom fields if needed

3. **Monitoring**:
   - Set up health checks
   - Monitor sync success rates
   - Review data accuracy regularly

---

**Congratulations! Your Employee Management System is now set up and running!** 🎉

