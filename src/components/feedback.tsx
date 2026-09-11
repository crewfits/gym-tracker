export function Feedback({success,error}:{success?:string;error?:string}){if(!success&&!error)return null;return <div className={`alert ${error?"error":""}`}>{error||success}</div>}
