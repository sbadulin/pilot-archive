"""Prints a presigned PUT URL: presign-put.py <bucket> <key> <content-type>. Run with the aws cli Python."""
import sys
from awscli.botocore.session import Session  # aws cli v2 vendors botocore here

bucket, key, ctype = sys.argv[1:4]
session = Session(profile='selectel')
client = session.create_client('s3', endpoint_url='https://s3.ru-6.storage.selcloud.ru',
                               region_name='ru-6', verify='/etc/ssl/cert.pem')
print(client.generate_presigned_url('put_object', Params={'Bucket': bucket, 'Key': key, 'ContentType': ctype},
                                    ExpiresIn=7200))
