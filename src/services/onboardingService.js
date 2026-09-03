import { Employees, EmployeeDocuments, DocumentTypes, Users, EmployeeContracts, OnboardingCases, OnboardingTasks } from '../models/raw.js';
import { nextId } from '../utils/id.js';

export async function syncOnboarding(actorId=null) {
  const employees=await Employees.find({deleted_at:null,employment_status:{$in:['probation','active']}}).lean();
  const types=await DocumentTypes.find({is_required:1,status:'active'}).lean();
  let touched=0;
  for(const e of employees){
    let c=await OnboardingCases.findOne({employee_id:e.id}).lean();
    if(!c){ c={id:await nextId('onboarding_cases'),employee_id:e.id,status:'in_progress',target_date:e.probation_end_date||e.join_date||null,created_at:new Date(),updated_at:new Date()}; await OnboardingCases.create(c); touched++; }
    const docs=await EmployeeDocuments.find({employee_id:e.id}).lean(); const docTypes=new Set(docs.filter(d=>['received','uploaded'].includes(d.document_status)||['verified','approved'].includes(d.verification_status)).map(d=>Number(d.document_type_id)));
    const user=await Users.findOne({employee_id:e.id,status:'active'}).lean(); const contract=await EmployeeContracts.findOne({employee_id:e.id,status:{$in:['active','signed']}}).lean();
    const tasks=[
      ['PROFILE_CORE','Hoàn thiện thông tin nhân sự cốt lõi','profile',Boolean(e.full_name&&e.phone&&e.identity_number&&e.join_date),1],
      ...types.map(t=>[`DOC_${t.document_code}`,`Bổ sung ${t.document_name}`,'document',docTypes.has(Number(t.id)),1]),
      ['ACCOUNT','Tạo và liên kết tài khoản HRM','account',Boolean(user),1],['CONTRACT','Tạo hợp đồng lao động / thử việc','contract',Boolean(contract),1],['ORIENTATION','Hoàn thành hướng dẫn hội nhập','orientation',false,0]
    ];
    for(let i=0;i<tasks.length;i++){ const [code,name,group,done,required]=tasks[i]; const existing=await OnboardingTasks.findOne({case_id:c.id,task_code:code}).lean(); if(!existing) await OnboardingTasks.create({id:await nextId('onboarding_tasks'),case_id:c.id,task_code:code,task_name:name,task_group:group,status:done?'done':'todo',is_required:required,due_date:c.target_date,completed_at:done?new Date():null,completed_by:done?actorId:null,note:null,sort_order:(i+1)*10,created_at:new Date(),updated_at:new Date()}); else if(done&&existing.status==='todo') await OnboardingTasks.updateOne({id:existing.id},{$set:{status:'done',completed_at:new Date(),completed_by:actorId,updated_at:new Date()}}); }
  }
  return touched;
}
