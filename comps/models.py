from django.db import models


class SharesModel(models.Model):
    epic = models.CharField(max_length=10, default="")
    shares = models.FloatField(default=0.00)
    purchase_price = models.FloatField(default=0.00)

    def __str__(self):
        return self.epic
    
    class Meta:
        ordering = ['epic']
   
class UsersModel(models.Model):
    firstname =models.CharField(max_length=100,blank=True)
    lastname =models.CharField(max_length=100,blank=True)
    ftse_id = models.ManyToManyField('SharesModel')

    def __str__(self):
       return f'{self.firstname} {self.lastname}'

