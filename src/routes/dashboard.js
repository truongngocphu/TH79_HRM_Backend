import { Router } from 'express';
import {
  Employees, Branches, Departments, OnboardingCases, OnboardingTasks,
  DocumentTypes, EmployeeChangeRequests
} from '../models/raw.js';
import { notificationFeed } from '../services/notificationService.js';
import { analyticsSnapshot, anomalyList } from '../services/analyticsService.js';
import { enrichEmployees } from '../services/employeeService.js';
import { getDigitalDocumentCoverage, getRequiredDocumentTypes } from '../services/documentCoverageService.js';

const router=Router();

router.get('/',async(req,res)=>{
  const [total,probation,active,branches,departments,analytics,alertsAll,pendingSelfService]=await Promise.all([
    Employees.countDocuments({deleted_at:null}),
    Employees.countDocuments({deleted_at:null,employment_status:'probation'}),
    Employees.countDocuments({deleted_at:null,employment_status:'active'}),
    Branches.countDocuments({status:'active'}),
    Departments.countDocuments({status:'active'}),
    analyticsSnapshot(),
    notificationFeed(250),
    EmployeeChangeRequests.countDocuments({status:'pending'})
  ]);

  const [onboarding,onboardingTotal,onboardingDone,requiredTypes,recentRaw,anomalies]=await Promise.all([
    OnboardingCases.countDocuments({status:{$ne:'completed'}}),
    OnboardingTasks.countDocuments({}),
    OnboardingTasks.countDocuments({status:'done'}),
    getRequiredDocumentTypes(),
    Employees.find({deleted_at:null}).sort({join_date:-1,id:-1}).limit(6).lean(),
    anomalyList()
  ]);

  const alerts=alertsAll.slice(0,20);
  const counts=alertsAll.reduce((acc,item)=>{
    const key=item.type||'other';
    acc[key]=(acc[key]||0)+1;
    return acc;
  },{});
  const urgent=alertsAll.filter(x=>x.severity==='danger').length;
  const allActiveEmployees = await Employees.find({ deleted_at:null, employment_status:{ $in:['probation','active','on_leave'] } }).lean();
  const documentCoverage = await getDigitalDocumentCoverage(allActiveEmployees, requiredTypes);
  const recentEmployees=await enrichEmployees(recentRaw);

  res.json({
    stats:{
      total,probation,active,branches,departments,onboarding,
      dataQuality:analytics.dataQuality,
      missing_docs:documentCoverage.missingEmployees
    },
    alerts,
    analytics,
    onboardingSummary:{
      in_progress:onboarding,
      progress:onboardingTotal?Math.round(onboardingDone/onboardingTotal*100):0
    },
    pendingSelfService,
    anomalyCount:anomalies.length,
    smartAlerts:{
      total:alertsAll.length,
      urgent,
      counts:{
        probation:counts.probation||0,
        contract:counts.contract||0,
        missing_docs:documentCoverage.missingEmployees,
        document_expiry:counts.document_expiry||0,
        approval:counts.approval||0
      },
      items:alerts.slice(0,6)
    },
    branchChart:analytics.branch||[],
    documentProgress:{
      percent:documentCoverage.percent,
      completed:documentCoverage.completed,
      missing:documentCoverage.missing,
      total:documentCoverage.totalRequired,
      completeEmployees:Math.max(0,allActiveEmployees.length-documentCoverage.missingEmployees),
      missingEmployees:documentCoverage.missingEmployees
    },
    statusSummary:[
      {status:'probation',total:probation},
      {status:'active',total:active}
    ],
    recentEmployees
  });
});

export default router;
