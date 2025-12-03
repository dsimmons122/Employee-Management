# Employee Management System

A comprehensive employee management system that integrates with Azure Entra ID, NinjaOne, and Supabase to provide a unified view of employees, devices, tickets, and software licenses.

## 🌟 Features

### Core Functionality
- **Employee Management**: Centralized employee directory synced from Azure Entra ID
- **Advanced Filtering**: Filter employees by status, department, and office location
- **Device Tracking**: View all devices from NinjaOne with software inventory
- **Ticket Management**: Track support tickets linked to employees
- **License Management**: Monitor software licenses, usage, and expiration dates
- **Automated Sync**: Scheduled synchronization from external systems

### Key Capabilities
- ✅ Real-time sync with Azure Entra ID (employee data)
- ✅ NinjaOne integration for device and software tracking
- ✅ Multi-dimensional filtering (department, office location, employment status)
- ✅ Automatic status updates for new hires and terminations
- ✅ Comprehensive device and software inventory per employee
- ✅ License seat tracking and expiration monitoring
- ✅ Responsive modern UI with Tailwind CSS

## 🏗️ Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Integrations**: 
  - Microsoft Graph API (Azure Entra ID)
  - NinjaOne API
- **Deployment**: Vercel (with cron jobs)

## 📋 Requirements

Before setting up this project, you'll need:

1. **Supabase Account**
   - Create a project at [supabase.com](https://supabase.com)
   - Note your project URL and anon key

2. **Azure App Registration**
   - Access to Azure Portal with admin rights
   - Create an App Registration with Microsoft Graph API permissions

3. **NinjaOne Account**
   - API credentials (Client ID and Secret)
   - Know your region (US, EU, OC, or CA)

## 🚀 Getting Started

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd employee-management
npm install
```

### 2. Configure Supabase Database

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the schema from `supabase/schema.sql`
4. This will create all necessary tables, indexes, and RLS policies

### 3. Azure App Registration Setup

1. **Create App Registration**:
   - Go to Azure Portal > Azure Active Directory > App Registrations
   - Click "New registration"
   - Name: "Employee Management System"
   - Supported account types: "Accounts in this organizational directory only"
   - Redirect URI: Leave blank for now
   - Click "Register"

2. **Configure API Permissions**:
   - Go to "API permissions"
   - Click "Add a permission" > "Microsoft Graph" > "Application permissions"
   - Add these permissions:
     - `User.Read.All`
     - `Directory.Read.All`
     - `Organization.Read.All`
   - Click "Grant admin consent"

3. **Create Client Secret**:
   - Go to "Certificates & secrets"
   - Click "New client secret"
   - Add description and expiration
   - **Copy the secret value immediately** (you won't see it again)

4. **Note Your IDs**:
   - Application (client) ID
   - Directory (tenant) ID
   - Client secret value

### 4. NinjaOne API Setup

1. **Create API Credentials**:
   - Log into NinjaOne
   - Go to Administration > Apps > API
   - Click "Add" to create new API credentials
   - Select appropriate scopes (monitoring, management)
   - Note your Client ID and Client Secret

2. **Determine Your Region**:
   - US: `us` (app.ninjarmm.com)
   - Europe: `eu` (eu.ninjarmm.com)
   - Oceania: `oc` (oc.ninjarmm.com)
   - Canada: `ca` (ca.ninjarmm.com)

### 5. Environment Configuration

Create a `.env` file in the project root:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Azure Entra ID (Microsoft Graph API)
AZURE_CLIENT_ID=your-azure-app-client-id
AZURE_CLIENT_SECRET=your-azure-client-secret
AZURE_TENANT_ID=your-azure-tenant-id
AZURE_REDIRECT_URI=http://localhost:3000/api/auth/callback

# NinjaOne API
NINJA_CLIENT_ID=your-ninja-client-id
NINJA_CLIENT_SECRET=your-ninja-client-secret
NINJA_REGION=us

# Application Settings
NEXT_PUBLIC_APP_URL=http://localhost:3000
SYNC_CRON_SECRET=your-random-secret-for-cron-jobs
```

**Generate a secure secret** for `SYNC_CRON_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 7. Initial Data Sync

1. Navigate to the **Sync** page in the application
2. Click "Sync Now" for Azure Entra ID
3. Wait for completion
4. Click "Sync Now" for NinjaOne
5. Wait for completion
6. Check the **Employees** page to see synced data

## 📊 Database Schema

### Tables

- **employees**: Employee data from Azure Entra ID
- **devices**: Devices from NinjaOne
- **device_software**: Software installed on devices
- **tickets**: Support tickets linked to employees
- **licenses**: Software licenses
- **license_assignments**: License assignments to employees
- **sync_logs**: Synchronization history

See `supabase/schema.sql` for complete schema details.

## 🔄 Automated Synchronization

### Using Vercel Cron Jobs (Recommended)

The `vercel.json` file configures automatic syncs:
- **Azure Entra ID**: Daily at 2:00 AM
- **NinjaOne**: Daily at 3:00 AM

Deploy to Vercel and cron jobs will run automatically.

### Using Custom Cron Jobs

If not using Vercel, set up cron jobs on your server:

```bash
# Azure Entra ID sync (daily at 2 AM)
0 2 * * * curl -X POST https://your-domain.com/api/sync/entra-id \
  -H "Authorization: Bearer YOUR_SYNC_CRON_SECRET"

# NinjaOne sync (daily at 3 AM)
0 3 * * * curl -X POST https://your-domain.com/api/sync/ninjaone \
  -H "Authorization: Bearer YOUR_SYNC_CRON_SECRET"
```

## 📱 Pages Overview

### Home Dashboard (`/`)
Overview of all modules with quick access cards

### Employees (`/employees`)
- View all employees with advanced filtering
- Filter by status, department, office location, or search
- See device count and ticket count per employee
- Click to view detailed employee profile

### Employee Detail (`/employees/[id]`)
- Complete employee profile
- View all assigned devices with software inventory
- See ticket history
- Track license assignments

### Devices (`/devices`)
- All devices from NinjaOne
- See device assignments
- View device specifications and OS information

### Tickets (`/tickets`)
- All support tickets
- Filter by status (open, in progress, resolved, closed)
- See requester and ticket details

### Licenses (`/licenses`)
- Software license inventory
- Track seat usage
- Monitor expiration dates
- View costs and billing frequency

### Sync (`/sync`)
- Manual sync triggers
- View sync history and status
- Monitor sync success/failures

### Settings (`/settings`)
- Integration status overview
- Configuration guidance

## 🔐 Security Considerations

1. **Environment Variables**: Never commit `.env` file to version control
2. **API Keys**: Rotate secrets regularly
3. **Supabase RLS**: Row Level Security is enabled on all tables
4. **Cron Secret**: Use strong random secret for sync endpoints
5. **Azure Permissions**: Use minimal required permissions

## 🚀 Deployment

### Deploy to Vercel

1. **Push to GitHub**:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo>
git push -u origin main
```

2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables from your `.env` file
   - Deploy

3. **Configure Production URLs**:
   - Update `NEXT_PUBLIC_APP_URL` in Vercel environment variables
   - Update `AZURE_REDIRECT_URI` if using auth callbacks

4. **Verify Cron Jobs**:
   - Go to Vercel project settings
   - Check "Cron Jobs" tab
   - Verify schedules are active

## 🛠️ Customization

### Adding New Fields

To add custom employee fields:

1. Update Supabase schema:
```sql
ALTER TABLE employees ADD COLUMN custom_field VARCHAR(255);
```

2. Update TypeScript types in `lib/types.ts`
3. Update sync logic in `app/api/sync/entra-id/route.ts`
4. Update UI components as needed

### Custom Integrations

To add new integrations:

1. Create integration client in `lib/`
2. Create sync API route in `app/api/sync/[integration]/route.ts`
3. Add cron job to `vercel.json`
4. Update sync page UI

## 🐛 Troubleshooting

### Sync Failures

**Azure Entra ID sync fails**:
- Verify Azure App Registration permissions
- Check admin consent is granted
- Validate tenant ID and credentials
- Check sync logs for detailed errors

**NinjaOne sync fails**:
- Verify API credentials
- Check correct region is set
- Ensure API scopes include necessary permissions
- Review sync logs for specific errors

### Missing Data

**Employees not showing devices**:
- NinjaOne may need custom field mapping
- Update `app/api/sync/ninjaone/route.ts` to match your field names
- Verify employee email matches between systems

**Tickets not linking to employees**:
- Ensure ticket system provides requester email
- Update ticket sync logic to match your ticket system's API

## 📞 Support

For issues or questions:
1. Check sync logs in the Sync page
2. Review Supabase logs in dashboard
3. Check browser console for frontend errors
4. Verify all API credentials are correct

## 📄 License

This project is proprietary software for internal company use.

## 🎯 Future Enhancements

Potential features to add:
- [ ] Role-based access control
- [ ] Export employees to CSV/Excel
- [ ] Advanced reporting and analytics
- [ ] Email notifications for license expiration
- [ ] Custom fields per employee
- [ ] Integration with more ticket systems
- [ ] Mobile app
- [ ] Audit logs for all changes

---

**Built with ❤️ for better employee management**

