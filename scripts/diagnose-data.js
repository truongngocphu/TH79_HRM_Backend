import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import {
  Employees, Branches, Departments, Positions,
  EmployeeDocuments, EmployeeStatusHistory
} from '../src/models/raw.js';
import { employeeById, enrichEmployees } from '../src/services/employeeService.js';
import { hydrateLegacyId, hydrateLegacyIds } from '../src/utils/legacySeedIdentity.js';

await connectDb();

const activeFilter={ $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
const [totalEmployees,totalBranches,totalDepartments,totalPositions,totalDocuments]=await Promise.all([
  Employees.countDocuments(activeFilter),Branches.countDocuments({}),Departments.countDocuments({}),Positions.countDocuments({}),EmployeeDocuments.countDocuments({})
]);

const db=mongoose.connection.db;
const missingLegacyIds={};
for(const name of ['employees','branches','departments','positions','employee_documents','employee_status_history','onboarding_cases','onboarding_tasks']){
  missingLegacyIds[name]=await db.collection(name).countDocuments({$or:[{id:{$exists:false}},{id:null}]});
}

const rawFirst=await Employees.findOne(activeFilter).sort({employee_code:1,_id:1}).lean();
const first=hydrateLegacyId('employees',rawFirst);
const firstId=first?.id;
const firstEnriched=firstId!=null?await employeeById(firstId):null;
const firstDocs=firstId!=null?await EmployeeDocuments.countDocuments({employee_id:{$in:[firstId,String(firstId)]}}):0;
const firstHistory=firstId!=null?await EmployeeStatusHistory.countDocuments({employee_id:{$in:[firstId,String(firstId)]}}):0;

const [branchRows,positionRows]=await Promise.all([Branches.find({}).lean(),Positions.find({}).lean()]);
const hydratedBranches=hydrateLegacyIds('branches',branchRows);
const hydratedPositions=hydrateLegacyIds('positions',positionRows);
const branchIdsMissingAfterRecovery=hydratedBranches.filter(x=>x.id==null).length;
const positionIdsMissingAfterRecovery=hydratedPositions.filter(x=>x.id==null).length;

console.log('\n=== TH79 HRM DATA DIAGNOSTIC V7 ===');
console.table({employees:totalEmployees,branches:totalBranches,departments:totalDepartments,positions:totalPositions,documents:totalDocuments});
console.log('\nLegacy numeric ID physically missing in MongoDB:');
console.table(missingLegacyIds);
console.log('\nRuntime recovery status:');
console.table({branches_unresolved:branchIdsMissingAfterRecovery,positions_unresolved:positionIdsMissingAfterRecovery,employee_sample_id:firstId??'missing'});

console.log('\nEmployee sample:');
console.log({
  mongo_id:rawFirst?._id?.toString?.(),
  physical_id:rawFirst?.id,
  recovered_id:first?.id,
  employee_code:first?.employee_code,
  full_name:first?.full_name,
  branch_id:first?.branch_id,
  branch_name:firstEnriched?.branch_name,
  department_id:first?.department_id,
  department_name:firstEnriched?.department_name,
  position_id:first?.position_id,
  position_name:firstEnriched?.position_name,
  related_documents:firstDocs,
  status_history:firstHistory
});

const problems=[];
if(firstId==null)problems.push('Không khôi phục được định danh nhân viên mẫu.');
if(first?.branch_id&&!firstEnriched?.branch_name)problems.push('Không resolve được branch_id -> branch_name.');
if(first?.position_id&&!firstEnriched?.position_name)problems.push('Không resolve được position_id -> position_name.');
if(firstId!=null&&firstDocs===totalDocuments&&totalEmployees>1)problems.push('Lọc employee_documents trả toàn bộ hồ sơ.');
if(branchIdsMissingAfterRecovery)problems.push(`Còn ${branchIdsMissingAfterRecovery} chi nhánh không có định danh sau runtime recovery.`);
if(positionIdsMissingAfterRecovery)problems.push(`Còn ${positionIdsMissingAfterRecovery} chức vụ không có định danh sau runtime recovery.`);

if(problems.length){
  console.error('\n❌ Còn lỗi chức năng:');
  for(const p of problems)console.error(` - ${p}`);
  process.exitCode=1;
}else{
  console.log('\n✅ Backend V7 có thể resolve dữ liệu nhân sự/chi nhánh/chức vụ/hồ sơ đúng.');
  if(Object.values(missingLegacyIds).some(Number)){
    console.log('ℹ️ MongoDB vẫn có bản ghi thiếu legacy id vật lý, nhưng V7 đã khôi phục ID an toàn ở runtime.');
    console.log('   Có thể chạy repair:legacy-ids sau khi backup để làm sạch DB lâu dài; không bắt buộc để dùng UI.');
  }
}

await mongoose.disconnect();
