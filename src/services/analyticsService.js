import { Employees, Branches, Departments, EmployeeContracts, EmployeeStatusHistory } from '../models/raw.js';
import { enrichEmployees } from './employeeService.js';
import { getDigitalDocumentCoverage, getRequiredDocumentTypes } from './documentCoverageService.js';

export async function analyticsSnapshot() {
  const employees = await Employees.find({ deleted_at:null, employment_status:{ $in:['probation','active','on_leave'] } }).lean();
  const enriched = await enrichEmployees(employees);
  const now = new Date(); const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30 = new Date(now); in30.setDate(in30.getDate()+30);
  const contracts = await EmployeeContracts.find({}).lean();
  const expiring30 = contracts.filter(c => c.end_date && new Date(c.end_date)>=now && new Date(c.end_date)<=in30).length;
  const requiredTypes = await getRequiredDocumentTypes();
  const documentCoverage = await getDigitalDocumentCoverage(employees, requiredTypes);
  let coreScore=0, docScore=0, contractScore=0;
  if (employees.length) {
    const coreFields=['full_name','gender','date_of_birth','identity_number','phone','join_date','position_id','branch_id'];
    coreScore=Math.round(employees.reduce((sum,e)=>sum+coreFields.filter(k=>e[k]!==null&&e[k]!==''&&e[k]!==undefined).length/coreFields.length,0)/employees.length*100);
    docScore=documentCoverage.percent;
    const activeContractEmp=new Set(contracts.filter(c=>['active','signed'].includes(c.status)).map(c=>Number(c.employee_id)));
    contractScore=Math.round([...employees].filter(e=>activeContractEmp.has(Number(e.id))).length/employees.length*100);
  }
  const dataQuality=Math.round(coreScore*.5+docScore*.3+contractScore*.2);
  const group=(rows,key,label)=>Object.entries(rows.reduce((a,x)=>{const k=x[key]||'Chưa xác định';a[k]=(a[k]||0)+1;return a;},{})).map(([name,value])=>({name,value,label})).sort((a,b)=>b.value-a.value);
  const branch=group(enriched,'branch_name','Chi nhánh'); const department=group(enriched,'department_name','Phòng ban');
  const tenure=[{name:'< 3 tháng',value:0},{name:'3–6 tháng',value:0},{name:'6–12 tháng',value:0},{name:'> 1 năm',value:0}];
  for(const e of employees){ if(!e.join_date)continue; const months=(now-new Date(e.join_date))/(86400000*30.44); if(months<3)tenure[0].value++; else if(months<6)tenure[1].value++; else if(months<12)tenure[2].value++; else tenure[3].value++; }
  const history=await EmployeeStatusHistory.find({new_status:{$in:['resigned','terminated','inactive']}}).lean(); const monthly=[]; for(let i=11;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1), next=new Date(d.getFullYear(),d.getMonth()+1,1); monthly.push({month:`${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`, joined:employees.filter(e=>e.join_date&&new Date(e.join_date)>=d&&new Date(e.join_date)<next).length, left:history.filter(h=>{const v=h.effective_date||h.created_at;return v&&new Date(v)>=d&&new Date(v)<next}).length}); }
  const probation=employees.filter(e=>e.employment_status==='probation').length;
  return { total:employees.length, joinedThisMonth:employees.filter(e=>e.join_date&&new Date(e.join_date)>=startMonth).length, probation, expiring30, dataQuality, quality:{core:coreScore,documents:docScore,contracts:contractScore}, branch, department, tenure, monthly,
    insights:[
      probation/employees.length>.5?{severity:'warning',title:'Tỷ trọng thử việc đang cao',detail:`${Math.round(probation/employees.length*100)}% nhân sự hiện là thử việc.`}:null,
      dataQuality<70?{severity:'warning',title:'Chất lượng dữ liệu cần cải thiện',detail:`Data Quality hiện ${dataQuality}/100.`}:null,
      contractScore<70?{severity:'danger',title:'Tỷ lệ hợp đồng hiệu lực thấp',detail:`Chỉ ${contractScore}% nhân sự có hợp đồng hiệu lực.`}:null
    ].filter(Boolean)};
}

export async function anomalyList() {
  const employees = await Employees.find({deleted_at:null}).lean();
  const anomalies=[];
  for(const field of ['phone','email','identity_number']){
    const groups=new Map(); employees.forEach(e=>{const v=String(e[field]||'').trim().toLowerCase();if(!v)return;if(!groups.has(v))groups.set(v,[]);groups.get(v).push(e);});
    for(const [value,rows] of groups) if(rows.length>1) anomalies.push({severity:'danger',type:'duplicate',title:`Trùng ${field}`,detail:value,employees:rows.map(x=>({id:x.id,full_name:x.full_name,employee_code:x.employee_code}))});
  }
  for(const e of employees){ const missing=['phone','identity_number','join_date','branch_id','position_id'].filter(k=>!e[k]); if(missing.length>=3) anomalies.push({severity:'warning',type:'missing',title:'Thiếu dữ liệu cốt lõi',detail:`${e.full_name}: ${missing.join(', ')}`,employees:[{id:e.id,full_name:e.full_name,employee_code:e.employee_code}]}); }
  return anomalies;
}
